import { z } from "zod";

export const FLOW_SCHEMA_VERSION = 1;

export const EDGE_KINDS = ["SUCCESS", "TRUE", "FALSE", "ERROR", "LOOP_BODY", "LOOP_DONE", "FINALLY"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const ERROR_POLICIES = ["FAIL_FLOW", "FOLLOW_ERROR_EDGE", "CONTINUE", "USE_DEFAULT_VALUE"] as const;
export type ErrorPolicyMode = (typeof ERROR_POLICIES)[number];

export const VALUE_TYPES = ["page", "locator", "string", "number", "boolean", "json", "any"] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "IDs must be alphanumeric, dash or underscore");

export const inputBindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), nodeId: idSchema, output: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("variable"), name: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("literal"), value: z.unknown() }),
  z.object({ kind: z.literal("template"), template: z.string().max(10_000) }),
]);
export type InputBinding = z.infer<typeof inputBindingSchema>;

export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  backoffMs: z.number().int().min(0).max(60_000),
});
export type RetryPolicy = z.infer<typeof retryPolicySchema>;

export const errorPolicySchema = z.object({
  mode: z.enum(ERROR_POLICIES),
  defaultValue: z.unknown().optional(),
});
export type ErrorPolicy = z.infer<typeof errorPolicySchema>;

export const flowNodeSchema = z.object({
  id: idSchema,
  type: z.string().min(1).max(64),
  version: z.number().int().min(1),
  position: z.object({ x: z.number(), y: z.number() }),
  label: z.string().max(120).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  inputs: z.record(z.string(), inputBindingSchema).default({}),
  outputVariable: z.string().max(64).regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  timeoutMs: z.number().int().min(100).max(6 * 60 * 60 * 1000).optional(),
  retry: retryPolicySchema.optional(),
  errorPolicy: errorPolicySchema.optional(),
});
export type FlowNode = z.infer<typeof flowNodeSchema>;

export const flowEdgeSchema = z.object({
  id: idSchema,
  source: idSchema,
  target: idSchema,
  sourceHandle: z.string().max(64).optional(),
  targetHandle: z.string().max(64).optional(),
  kind: z.enum(EDGE_KINDS).default("SUCCESS"),
  condition: z.string().max(500).optional(),
  priority: z.number().int().min(0).max(1000).default(100),
});
export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowSettingsSchema = z.object({
  timeoutMs: z.number().int().min(1000).max(6 * 60 * 60 * 1000).optional(),
  identityRef: z.string().max(64).optional(),
  maxAttempts: z.number().int().min(1).max(5).default(1),
  screenshotOnNavigation: z.boolean().default(true),
  viewport: z.object({ width: z.number().int().min(320).max(3840), height: z.number().int().min(240).max(2160) }).optional(),
});

export const flowDefinitionSchema = z.object({
  schemaVersion: z.literal(FLOW_SCHEMA_VERSION),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.unknown()).default({}),
  settings: flowSettingsSchema.default({ maxAttempts: 1, screenshotOnNavigation: true }),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
});
export type FlowDefinition = z.infer<typeof flowDefinitionSchema>;
export type FlowDefinitionInput = z.input<typeof flowDefinitionSchema>;

export function emptyFlowDefinition(name: string): FlowDefinition {
  return {
    schemaVersion: 1,
    name,
    description: "",
    variables: {},
    settings: { maxAttempts: 1, screenshotOnNavigation: true },
    nodes: [
      { id: "start", type: "control.start", version: 1, position: { x: 80, y: 120 }, label: "Start", config: {}, inputs: {} },
    ],
    edges: [],
  };
}

// ---------- Node catalog field specs (drive both Zod validation and UI forms) ----------
export interface FieldSpec {
  name: string;
  label: string;
  type: "string" | "text" | "number" | "boolean" | "select" | "json" | "credentialRef" | "template";
  required?: boolean;
  options?: string[];
  default?: unknown;
  sensitive?: boolean;
  help?: string;
  min?: number;
  max?: number;
}

export function fieldsToZod(fields: FieldSpec[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let s: z.ZodTypeAny;
    switch (f.type) {
      case "string":
      case "text":
      case "template":
        s = z.string().max(f.max ?? 10_000);
        if (f.required) s = (s as z.ZodString).min(1, `${f.label} is required`);
        break;
      case "credentialRef":
        s = z.string().regex(/^credential:[A-Za-z0-9_-]+(#[A-Za-z0-9_-]+)?$/, "Must be credential:<id>#<field>");
        break;
      case "number":
        s = z.number();
        if (f.min !== undefined) s = (s as z.ZodNumber).min(f.min);
        if (f.max !== undefined) s = (s as z.ZodNumber).max(f.max);
        break;
      case "boolean":
        s = z.boolean();
        break;
      case "select":
        s = z.enum((f.options ?? ["_"]) as [string, ...string[]]);
        break;
      case "json":
        s = z.unknown();
        break;
    }
    shape[f.name] = f.required ? s : s.optional().nullable();
  }
  return z.object(shape);
}

export const CREDENTIAL_REF_RE = /^credential:([A-Za-z0-9_-]+)(?:#([A-Za-z0-9_-]+))?$/;
export const TEMPLATE_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+|\[\d+\])*)\s*\}\}/g;
