import { config } from "@/core/config";
import { errors } from "@/core/security";
import { NODE_CATALOG, getNodeMeta } from "@/nodes/catalog";
import { compileFlow } from "@/flow/compiler";
import { emptyFlowDefinition, flowDefinitionSchema } from "@/flow/schema";

/** Provider-neutral AI boundary for Release 1: interface + Disabled provider + test-only Fake provider. */
export interface AIToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface AIProvider {
  readonly name: string;
  readonly enabled: boolean;
  complete(prompt: string, tools: AIToolSchema[]): Promise<{ text: string; toolCalls: { name: string; arguments: Record<string, unknown> }[] }>;
}

export const AI_TOOL_SCHEMAS: AIToolSchema[] = [
  { name: "listNodeTypes", description: "List available node types", parameters: { type: "object", properties: {} } },
  { name: "getNodeSchema", description: "Get config/input/output schema for a node type", parameters: { type: "object", properties: { type: { type: "string" } }, required: ["type"] } },
  { name: "getFlowSchema", description: "Get the Flow JSON schema version and shape", parameters: { type: "object", properties: {} } },
  { name: "createFlowDraft", description: "Create an empty flow draft", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "addNode", description: "Add a node to a draft", parameters: { type: "object", properties: { flowId: { type: "string" }, type: { type: "string" }, config: { type: "object" } }, required: ["flowId", "type"] } },
  { name: "updateNode", description: "Update a node config", parameters: { type: "object", properties: { flowId: { type: "string" }, nodeId: { type: "string" }, config: { type: "object" } }, required: ["flowId", "nodeId"] } },
  { name: "removeNode", description: "Remove a node", parameters: { type: "object", properties: { flowId: { type: "string" }, nodeId: { type: "string" } }, required: ["flowId", "nodeId"] } },
  { name: "connectNodes", description: "Connect two nodes with an edge kind", parameters: { type: "object", properties: { flowId: { type: "string" }, source: { type: "string" }, target: { type: "string" }, kind: { type: "string" } }, required: ["flowId", "source", "target"] } },
  { name: "disconnectNodes", description: "Remove an edge", parameters: { type: "object", properties: { flowId: { type: "string" }, edgeId: { type: "string" } }, required: ["flowId", "edgeId"] } },
  { name: "validateFlow", description: "Validate a flow definition against the schema", parameters: { type: "object", properties: { definition: { type: "object" } }, required: ["definition"] } },
  { name: "compileFlow", description: "Compile a flow and return diagnostics (never launches a browser)", parameters: { type: "object", properties: { definition: { type: "object" } }, required: ["definition"] } },
  { name: "explainDiagnostic", description: "Explain a compiler diagnostic code", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
  { name: "repairFlow", description: "Propose a repaired flow definition (Release 3)", parameters: { type: "object", properties: { definition: { type: "object" } }, required: ["definition"] } },
  { name: "estimateExecution", description: "Estimate resources for a flow", parameters: { type: "object", properties: { definition: { type: "object" } }, required: ["definition"] } },
  { name: "generateTestFlow", description: "Generate a minimal test flow for a node type", parameters: { type: "object", properties: { type: { type: "string" } }, required: ["type"] } },
];

export class DisabledAIProvider implements AIProvider {
  readonly name = "disabled";
  readonly enabled = false;
  async complete(): Promise<never> {
    throw errors.system("AI_DISABLED", "AI provider is not configured", 503);
  }
}

/** Test-only provider: deterministic responses; refused in production by validateConfig(). */
export class FakeAIProvider implements AIProvider {
  readonly name = "fake";
  readonly enabled = true;
  async complete(prompt: string): Promise<{ text: string; toolCalls: { name: string; arguments: Record<string, unknown> }[] }> {
    return { text: `fake:${prompt.slice(0, 32)}`, toolCalls: [{ name: "listNodeTypes", arguments: {} }] };
  }
}

export function getAIProvider(): AIProvider {
  if (config.aiProvider === "fake") {
    if (config.env === "production") throw errors.system("AI_FAKE_IN_PROD", "Fake AI provider is not allowed in production", 500);
    return new FakeAIProvider();
  }
  return new DisabledAIProvider();
}

/** Safe, side-effect-free tool implementations that the AI layer may call (compiler boundary). */
export const aiReadOnlyTools = {
  listNodeTypes: () => NODE_CATALOG.map((n) => ({ type: n.type, displayName: n.displayName, category: n.category })),
  getNodeSchema: (type: string) => getNodeMeta(type) ?? null,
  getFlowSchema: () => ({ schemaVersion: 1, shape: Object.keys(flowDefinitionSchema.shape) }),
  createFlowDraft: (name: string) => emptyFlowDefinition(name),
  validateFlow: (definition: unknown) => flowDefinitionSchema.safeParse(definition).success,
  compileFlow: (definition: unknown) => compileFlow(definition),
  estimateExecution: (definition: unknown) => compileFlow(definition).compiled?.estimate ?? null,
};
