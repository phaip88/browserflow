import type { EdgeKind, FieldSpec, RetryPolicy, ValueType } from "@/flow/schema";

export const NODE_REGISTRY_VERSION = "r1.0.0";

export type Capability = "browser" | "network" | "filesystem";
export interface PortSpec {
  name: string;
  type: ValueType;
  required?: boolean;
  description?: string;
}
export interface NodeMeta {
  type: string;
  version: number;
  category: "control" | "page" | "locator" | "element" | "data" | "integration";
  displayName: string;
  description: string;
  fields: FieldSpec[];
  inputs: PortSpec[];
  outputs: PortSpec[];
  sourceHandles: EdgeKind[];
  acceptsIncoming: boolean;
  defaultTimeoutMs: number;
  defaultRetryPolicy?: RetryPolicy;
  requiredCapabilities: Capability[];
  sensitiveFields: string[];
  sideEffectLevel: "none" | "read" | "write" | "external";
  supportsCancellation: boolean;
  supportsRetry: boolean;
  /** element.* nodes may build a fresh Locator from config.selector when no locator input is bound */
  allowSelectorFallback?: boolean;
}

const PAGE_IN: PortSpec = { name: "page", type: "page", description: "Page (defaults to the current page)" };
const LOCATOR_IN: PortSpec = { name: "locator", type: "locator", required: true, description: "Upstream locator" };
const SELECTOR_FIELD: FieldSpec = { name: "selector", label: "CSS selector (fallback)", type: "string", help: "Used only when no locator input is connected" };
const STRICT_FIELD: FieldSpec = { name: "strict", label: "Strict (fail on multiple matches)", type: "boolean", default: false };

function meta(partial: Omit<NodeMeta, "version" | "acceptsIncoming" | "supportsCancellation" | "supportsRetry" | "defaultTimeoutMs" | "sourceHandles"> & Partial<NodeMeta>): NodeMeta {
  return {
    version: 1,
    acceptsIncoming: true,
    supportsCancellation: true,
    supportsRetry: true,
    defaultTimeoutMs: 30_000,
    sourceHandles: ["SUCCESS"],
    ...partial,
  };
}

const controlNodes: NodeMeta[] = [
  meta({ type: "control.start", category: "control", displayName: "Start", description: "Entry point of the flow.", fields: [], inputs: [], outputs: [{ name: "inputs", type: "json" }], sourceHandles: ["SUCCESS", "FINALLY"], acceptsIncoming: false, requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", supportsRetry: false }),
  meta({ type: "control.end", category: "control", displayName: "End", description: "Marks a terminal point.", fields: [], inputs: [], outputs: [], sourceHandles: [], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", supportsRetry: false }),
  meta({ type: "control.if", category: "control", displayName: "If", description: "Routes to TRUE or FALSE depending on the condition input.", fields: [{ name: "negate", label: "Negate", type: "boolean", default: false }], inputs: [{ name: "condition", type: "any", required: true }], outputs: [{ name: "result", type: "boolean" }], sourceHandles: ["TRUE", "FALSE"], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", supportsRetry: false }),
  meta({ type: "control.foreach", category: "control", displayName: "For Each", description: "Runs the LOOP_BODY subgraph once per item, sequentially.", fields: [{ name: "maxIterations", label: "Max iterations", type: "number", default: 100, min: 1, max: 100000 }], inputs: [{ name: "items", type: "json", required: true, description: "Array or number (count)" }], outputs: [{ name: "count", type: "number" }, { name: "results", type: "json" }], sourceHandles: ["LOOP_BODY", "LOOP_DONE"], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", supportsRetry: false }),
  meta({ type: "control.wait", category: "control", displayName: "Wait", description: "Sleeps for a bounded duration.", fields: [{ name: "ms", label: "Milliseconds", type: "number", required: true, default: 1000, min: 0, max: 300000 }], inputs: [], outputs: [{ name: "waitedMs", type: "number" }], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 310_000 }),
  meta({ type: "control.fail", category: "control", displayName: "Fail", description: "Fails the flow with a message.", fields: [{ name: "message", label: "Message", type: "template", required: true, default: "Flow failed" }], inputs: [], outputs: [], sourceHandles: [], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", supportsRetry: false }),
  meta({ type: "control.return", category: "control", displayName: "Return", description: "Stops the flow immediately and sets the execution output.", fields: [], inputs: [{ name: "value", type: "any" }], outputs: [], sourceHandles: [], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", supportsRetry: false }),
];

const pageNodes: NodeMeta[] = [
  meta({ type: "page.goto", category: "page", displayName: "Go to URL", description: "Navigates the page to a URL (network policy enforced).", fields: [{ name: "url", label: "URL", type: "template", required: true }, { name: "waitUntil", label: "Wait until", type: "select", options: ["load", "domcontentloaded", "networkidle", "commit"], default: "load" }], inputs: [PAGE_IN, { name: "url", type: "string" }], outputs: [{ name: "url", type: "string" }, { name: "status", type: "number" }, { name: "page", type: "page" }], requiredCapabilities: ["browser", "network"], sensitiveFields: [], sideEffectLevel: "external", defaultRetryPolicy: { maxAttempts: 2, backoffMs: 1000 } }),
  meta({ type: "page.reload", category: "page", displayName: "Reload", description: "Reloads the page.", fields: [], inputs: [PAGE_IN], outputs: [{ name: "url", type: "string" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "external" }),
  meta({ type: "page.title", category: "page", displayName: "Page title", description: "Reads document.title.", fields: [], inputs: [PAGE_IN], outputs: [{ name: "title", type: "string" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "read" }),
  meta({ type: "page.url", category: "page", displayName: "Page URL", description: "Reads the current URL.", fields: [], inputs: [PAGE_IN], outputs: [{ name: "url", type: "string" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "read" }),
  meta({ type: "page.screenshot", category: "page", displayName: "Screenshot", description: "Captures a screenshot artifact.", fields: [{ name: "fullPage", label: "Full page", type: "boolean", default: false }, { name: "name", label: "Artifact name", type: "string", default: "screenshot" }], inputs: [PAGE_IN], outputs: [{ name: "artifactId", type: "string" }, { name: "sizeBytes", type: "number" }], requiredCapabilities: ["browser", "filesystem"], sensitiveFields: [], sideEffectLevel: "write" }),
  meta({ type: "page.waitForURL", category: "page", displayName: "Wait for URL", description: "Waits until the URL matches a glob or substring.", fields: [{ name: "pattern", label: "URL pattern (glob)", type: "template", required: true }], inputs: [PAGE_IN], outputs: [{ name: "url", type: "string" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "read" }),
  meta({ type: "page.waitForLoadState", category: "page", displayName: "Wait for load state", description: "Waits for a page load state.", fields: [{ name: "state", label: "State", type: "select", options: ["load", "domcontentloaded", "networkidle"], default: "load" }], inputs: [PAGE_IN], outputs: [{ name: "state", type: "string" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "read" }),
];

const locatorOut: PortSpec[] = [{ name: "locator", type: "locator" }];
const locatorNodes: NodeMeta[] = [
  meta({ type: "locator.css", category: "locator", displayName: "Locator: CSS", description: "Creates a locator from a CSS selector.", fields: [{ name: "selector", label: "CSS selector", type: "string", required: true }], inputs: [PAGE_IN, { name: "parent", type: "locator", description: "Optional parent locator to chain from" }], outputs: locatorOut, requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 5000 }),
  meta({ type: "locator.text", category: "locator", displayName: "Locator: Text", description: "Creates a locator by visible text.", fields: [{ name: "text", label: "Text", type: "template", required: true }, { name: "exact", label: "Exact match", type: "boolean", default: false }], inputs: [PAGE_IN, { name: "parent", type: "locator" }], outputs: locatorOut, requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 5000 }),
  meta({ type: "locator.role", category: "locator", displayName: "Locator: Role", description: "Creates a locator by ARIA role and name.", fields: [{ name: "role", label: "Role", type: "select", required: true, options: ["button", "link", "textbox", "checkbox", "radio", "combobox", "heading", "listitem", "row", "cell", "option", "menuitem", "tab", "dialog", "img"] }, { name: "name", label: "Accessible name", type: "template" }, { name: "exact", label: "Exact name", type: "boolean", default: false }], inputs: [PAGE_IN, { name: "parent", type: "locator" }], outputs: locatorOut, requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 5000 }),
  meta({ type: "locator.first", category: "locator", displayName: "Locator: First", description: "Narrows an upstream locator to the first match.", fields: [], inputs: [LOCATOR_IN], outputs: locatorOut, requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 5000 }),
  meta({ type: "locator.nth", category: "locator", displayName: "Locator: Nth", description: "Narrows an upstream locator to the nth match.", fields: [{ name: "index", label: "Index (0-based)", type: "number", default: 0, min: 0 }], inputs: [LOCATOR_IN, { name: "index", type: "number" }], outputs: locatorOut, requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 5000 }),
  meta({ type: "locator.count", category: "locator", displayName: "Locator: Count", description: "Counts matching elements.", fields: [], inputs: [LOCATOR_IN], outputs: [{ name: "count", type: "number" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "read", defaultTimeoutMs: 10_000 }),
  meta({ type: "locator.waitFor", category: "locator", displayName: "Locator: Wait for", description: "Waits for a locator to reach a state.", fields: [{ name: "state", label: "State", type: "select", options: ["attached", "detached", "visible", "hidden"], default: "visible" }], inputs: [LOCATOR_IN], outputs: [{ name: "ok", type: "boolean" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "read" }),
];

const elementNodes: NodeMeta[] = [
  meta({ type: "element.click", category: "element", displayName: "Click", description: "Clicks an element.", fields: [SELECTOR_FIELD, { name: "button", label: "Button", type: "select", options: ["left", "right", "middle"], default: "left" }, { name: "clickCount", label: "Click count", type: "number", default: 1, min: 1, max: 3 }, STRICT_FIELD], inputs: [{ name: "locator", type: "locator" }, PAGE_IN], outputs: [{ name: "clicked", type: "boolean" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "external", allowSelectorFallback: true }),
  meta({ type: "element.fill", category: "element", displayName: "Fill", description: "Fills an input with text (supports CredentialRef).", fields: [SELECTOR_FIELD, { name: "value", label: "Value", type: "template", help: "Supports {{variables}} and credential:<id>#<field>" }, STRICT_FIELD], inputs: [{ name: "locator", type: "locator" }, PAGE_IN, { name: "value", type: "string" }], outputs: [{ name: "filled", type: "boolean" }], requiredCapabilities: ["browser"], sensitiveFields: ["value"], sideEffectLevel: "external", allowSelectorFallback: true }),
  meta({ type: "element.press", category: "element", displayName: "Press key", description: "Presses a keyboard key on an element.", fields: [SELECTOR_FIELD, { name: "key", label: "Key", type: "string", required: true, default: "Enter" }], inputs: [{ name: "locator", type: "locator" }, PAGE_IN], outputs: [{ name: "pressed", type: "string" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "external", allowSelectorFallback: true }),
  meta({ type: "element.selectOption", category: "element", displayName: "Select option", description: "Selects an option in a <select>.", fields: [SELECTOR_FIELD, { name: "value", label: "Option value or label", type: "template", required: true }], inputs: [{ name: "locator", type: "locator" }, PAGE_IN, { name: "value", type: "string" }], outputs: [{ name: "selected", type: "json" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "external", allowSelectorFallback: true }),
  meta({ type: "element.check", category: "element", displayName: "Check / Uncheck", description: "Sets a checkbox state.", fields: [SELECTOR_FIELD, { name: "checked", label: "Checked", type: "boolean", default: true }], inputs: [{ name: "locator", type: "locator" }, PAGE_IN], outputs: [{ name: "checked", type: "boolean" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "external", allowSelectorFallback: true }),
  meta({ type: "element.innerText", category: "element", displayName: "Inner text", description: "Reads innerText.", fields: [SELECTOR_FIELD], inputs: [{ name: "locator", type: "locator" }, PAGE_IN], outputs: [{ name: "text", type: "string" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "read", allowSelectorFallback: true }),
  meta({ type: "element.textContent", category: "element", displayName: "Text content", description: "Reads textContent.", fields: [SELECTOR_FIELD], inputs: [{ name: "locator", type: "locator" }, PAGE_IN], outputs: [{ name: "text", type: "string" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "read", allowSelectorFallback: true }),
  meta({ type: "element.getAttribute", category: "element", displayName: "Get attribute", description: "Reads an attribute value.", fields: [SELECTOR_FIELD, { name: "attribute", label: "Attribute", type: "string", required: true, default: "href" }], inputs: [{ name: "locator", type: "locator" }, PAGE_IN], outputs: [{ name: "value", type: "string" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "read", allowSelectorFallback: true }),
  meta({ type: "element.isVisible", category: "element", displayName: "Is visible", description: "Checks element visibility without waiting.", fields: [SELECTOR_FIELD], inputs: [{ name: "locator", type: "locator" }, PAGE_IN], outputs: [{ name: "visible", type: "boolean" }], requiredCapabilities: ["browser"], sensitiveFields: [], sideEffectLevel: "read", allowSelectorFallback: true, defaultTimeoutMs: 5000 }),
];

const dataNodes: NodeMeta[] = [
  meta({ type: "data.constant", category: "data", displayName: "Constant", description: "Emits a constant JSON value.", fields: [{ name: "value", label: "Value (JSON)", type: "json", required: true, default: "" }], inputs: [], outputs: [{ name: "value", type: "any" }], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 1000 }),
  meta({ type: "data.setVariable", category: "data", displayName: "Set variable", description: "Stores a value in the current scope.", fields: [{ name: "name", label: "Variable name", type: "string", required: true }, { name: "scope", label: "Scope", type: "select", options: ["current", "flow"], default: "flow" }], inputs: [{ name: "value", type: "any", required: true }], outputs: [{ name: "value", type: "any" }], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 1000 }),
  meta({ type: "data.getVariable", category: "data", displayName: "Get variable", description: "Reads a variable through the scope chain.", fields: [{ name: "name", label: "Variable name", type: "string", required: true }, { name: "default", label: "Default (JSON)", type: "json" }], inputs: [], outputs: [{ name: "value", type: "any" }], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 1000 }),
  meta({ type: "data.template", category: "data", displayName: "Template", description: "Renders {{variable}} placeholders into a string.", fields: [{ name: "template", label: "Template", type: "template", required: true }], inputs: [{ name: "context", type: "json" }], outputs: [{ name: "text", type: "string" }], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 1000 }),
  meta({ type: "data.jsonParse", category: "data", displayName: "JSON parse", description: "Parses a JSON string.", fields: [], inputs: [{ name: "text", type: "string", required: true }], outputs: [{ name: "value", type: "json" }], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 1000 }),
  meta({ type: "data.jsonStringify", category: "data", displayName: "JSON stringify", description: "Serializes a value to JSON.", fields: [{ name: "pretty", label: "Pretty print", type: "boolean", default: false }], inputs: [{ name: "value", type: "any", required: true }], outputs: [{ name: "text", type: "string" }], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 1000 }),
  meta({ type: "data.compare", category: "data", displayName: "Compare", description: "Compares two values with an operator.", fields: [{ name: "operator", label: "Operator", type: "select", required: true, options: ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "startsWith", "endsWith", "matches", "isEmpty", "isNotEmpty"], default: "eq" }, { name: "right", label: "Right value (used if input not bound)", type: "template" }], inputs: [{ name: "left", type: "any", required: true }, { name: "right", type: "any" }], outputs: [{ name: "result", type: "boolean" }], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 1000 }),
  meta({ type: "data.randomString", category: "data", displayName: "Random string", description: "Generates a random string.", fields: [{ name: "length", label: "Length", type: "number", default: 12, min: 1, max: 256 }, { name: "alphabet", label: "Alphabet", type: "select", options: ["alphanumeric", "alpha", "numeric", "hex"], default: "alphanumeric" }], inputs: [], outputs: [{ name: "value", type: "string" }], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "none", defaultTimeoutMs: 1000 }),
];

const integrationNodes: NodeMeta[] = [
  meta({ type: "integration.httpRequest", category: "integration", displayName: "HTTP request", description: "Performs an HTTP request with SSRF protection.", fields: [{ name: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], default: "GET" }, { name: "url", label: "URL", type: "template", required: true }, { name: "headers", label: "Headers (JSON object)", type: "json" }, { name: "body", label: "Body", type: "template" }, { name: "authorization", label: "Authorization header (CredentialRef allowed)", type: "template", sensitive: true }, { name: "parseJson", label: "Parse JSON response", type: "boolean", default: true }], inputs: [{ name: "url", type: "string" }, { name: "body", type: "any" }], outputs: [{ name: "status", type: "number" }, { name: "headers", type: "json" }, { name: "body", type: "any" }], requiredCapabilities: ["network"], sensitiveFields: ["authorization", "headers"], sideEffectLevel: "external", defaultRetryPolicy: { maxAttempts: 2, backoffMs: 500 } }),
  meta({ type: "integration.readFile", category: "integration", displayName: "Read file", description: "Reads a text file from the execution's artifact sandbox.", fields: [{ name: "path", label: "Relative path", type: "string", required: true }], inputs: [{ name: "path", type: "string" }], outputs: [{ name: "content", type: "string" }, { name: "sizeBytes", type: "number" }], requiredCapabilities: ["filesystem"], sensitiveFields: [], sideEffectLevel: "read" }),
  meta({ type: "integration.writeFile", category: "integration", displayName: "Write file", description: "Writes a text file as an artifact.", fields: [{ name: "path", label: "Relative path", type: "string", required: true, default: "output.txt" }, { name: "content", label: "Content", type: "template" }, { name: "contentType", label: "Content type", type: "string", default: "text/plain" }], inputs: [{ name: "content", type: "any" }], outputs: [{ name: "artifactId", type: "string" }, { name: "sizeBytes", type: "number" }], requiredCapabilities: ["filesystem"], sensitiveFields: [], sideEffectLevel: "write" }),
  meta({ type: "integration.notify", category: "integration", displayName: "Notify", description: "Emits a notification event visible in the execution log.", fields: [{ name: "level", label: "Level", type: "select", options: ["info", "warning", "error"], default: "info" }, { name: "message", label: "Message", type: "template", required: true }], inputs: [{ name: "data", type: "any" }], outputs: [{ name: "delivered", type: "boolean" }], requiredCapabilities: [], sensitiveFields: [], sideEffectLevel: "write", defaultTimeoutMs: 2000 }),
];

export const NODE_CATALOG: NodeMeta[] = [...controlNodes, ...pageNodes, ...locatorNodes, ...elementNodes, ...dataNodes, ...integrationNodes];
export const NODE_INDEX: ReadonlyMap<string, NodeMeta> = new Map(NODE_CATALOG.map((n) => [n.type, n]));
export function getNodeMeta(type: string): NodeMeta | undefined {
  return NODE_INDEX.get(type);
}
