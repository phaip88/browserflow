import type { FlowDefinition, FlowEdge, FlowNode, InputBinding, EdgeKind } from "@/flow/schema";

export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  definition: FlowDefinition;
}

type N = { id: string; type: string; config?: Record<string, unknown>; inputs?: Record<string, InputBinding>; label?: string; outputVariable?: string; errorPolicy?: FlowNode["errorPolicy"] };
type E = [string, string, EdgeKind?];

function build(name: string, description: string, nodes: N[], edges: E[], variables: Record<string, unknown> = {}): FlowDefinition {
  const fnodes: FlowNode[] = nodes.map((n, i) => ({ id: n.id, type: n.type, version: 1, position: { x: 80 + (i % 4) * 260, y: 80 + Math.floor(i / 4) * 160 }, label: n.label, config: n.config ?? {}, inputs: n.inputs ?? {}, outputVariable: n.outputVariable, errorPolicy: n.errorPolicy }));
  const fedges: FlowEdge[] = edges.map(([s, t, k], i) => ({ id: `e${i + 1}`, source: s, target: t, kind: k ?? "SUCCESS", priority: 100 }));
  return { schemaVersion: 1, name, description, variables: { baseUrl: "http://127.0.0.1:3000/e2e-site", ...variables }, settings: { maxAttempts: 1, screenshotOnNavigation: true }, nodes: fnodes, edges: fedges };
}
const fromNode = (nodeId: string, output: string): InputBinding => ({ kind: "node", nodeId, output });
const fromVar = (name: string): InputBinding => ({ kind: "variable", name });
const lit = (value: unknown): InputBinding => ({ kind: "literal", value });

export const TEMPLATES: FlowTemplate[] = [
  {
    id: "page-title-url",
    name: "Read page title and URL",
    description: "Navigates to a page, reads its title and URL and returns them.",
    category: "basics",
    definition: build("Read page title and URL", "Navigate and read title/url", [
      { id: "start", type: "control.start" },
      { id: "goto", type: "page.goto", config: { url: "{{baseUrl}}/index.html" } },
      { id: "title", type: "page.title", outputVariable: "title" },
      { id: "url", type: "page.url", outputVariable: "currentUrl" },
      { id: "summary", type: "data.template", config: { template: "{{title}} @ {{currentUrl}}" } },
      { id: "ret", type: "control.return", inputs: { value: fromNode("summary", "text") } },
    ], [["start", "goto"], ["goto", "title"], ["title", "url"], ["url", "summary"], ["summary", "ret"]]),
  },
  {
    id: "form-fill",
    name: "Fill and submit a form",
    description: "Fills text inputs, selects an option, checks a box and submits, then reads the confirmation.",
    category: "forms",
    definition: build("Fill and submit a form", "Form automation", [
      { id: "start", type: "control.start" },
      { id: "goto", type: "page.goto", config: { url: "{{baseUrl}}/form.html" } },
      { id: "name", type: "element.fill", config: { selector: "#name", value: "{{fullName}}" } },
      { id: "email", type: "element.fill", config: { selector: "#email", value: "{{email}}" } },
      { id: "plan", type: "element.selectOption", config: { selector: "#plan", value: "pro" } },
      { id: "agree", type: "element.check", config: { selector: "#agree", checked: true } },
      { id: "submit", type: "element.click", config: { selector: "#submit" } },
      { id: "wait", type: "locator.css", config: { selector: "#result" } },
      { id: "visible", type: "locator.waitFor", config: { state: "visible" }, inputs: { locator: fromNode("wait", "locator") } },
      { id: "read", type: "element.innerText", config: { selector: "#result" } },
      { id: "ret", type: "control.return", inputs: { value: fromNode("read", "text") } },
    ], [["start", "goto"], ["goto", "name"], ["name", "email"], ["email", "plan"], ["plan", "agree"], ["agree", "submit"], ["submit", "wait"], ["wait", "visible"], ["visible", "read"], ["read", "ret"]], { fullName: "Ada Lovelace", email: "ada@example.com" }),
  },
  {
    id: "login-read",
    name: "Login with credential and read protected content",
    description: "Uses a CredentialRef (credential:<id>#password) to log in and read a protected element. Edit the credential reference before running.",
    category: "auth",
    definition: build("Login and read", "Login using a credential", [
      { id: "start", type: "control.start" },
      { id: "goto", type: "page.goto", config: { url: "{{baseUrl}}/login.html" } },
      { id: "user", type: "element.fill", config: { selector: "#username", value: "{{username}}" } },
      { id: "pass", type: "element.fill", config: { selector: "#password", value: "credential:site-login#password" } },
      { id: "submit", type: "element.click", config: { selector: "#login" } },
      { id: "waitUrl", type: "page.waitForURL", config: { pattern: "**/dashboard.html" } },
      { id: "secret", type: "element.innerText", config: { selector: "#welcome" } },
      { id: "ret", type: "control.return", inputs: { value: fromNode("secret", "text") } },
    ], [["start", "goto"], ["goto", "user"], ["user", "pass"], ["pass", "submit"], ["submit", "waitUrl"], ["waitUrl", "secret"], ["secret", "ret"]], { username: "demo" }),
  },
  {
    id: "scheduled-screenshot",
    name: "Scheduled screenshot",
    description: "Takes a full-page screenshot artifact. Pair with a Schedule for periodic captures.",
    category: "monitoring",
    definition: build("Scheduled screenshot", "Periodic screenshot", [
      { id: "start", type: "control.start" },
      { id: "goto", type: "page.goto", config: { url: "{{baseUrl}}/index.html" } },
      { id: "load", type: "page.waitForLoadState", config: { state: "networkidle" } },
      { id: "shot", type: "page.screenshot", config: { fullPage: true, name: "scheduled" } },
      { id: "end", type: "control.end" },
    ], [["start", "goto"], ["goto", "load"], ["load", "shot"], ["shot", "end"]]),
  },
  {
    id: "list-scrape",
    name: "Collect list items",
    description: "Counts list rows, iterates with foreach and collects the text of each row into a file.",
    category: "scraping",
    definition: build("Collect list items", "List collection with foreach", [
      { id: "start", type: "control.start" },
      { id: "goto", type: "page.goto", config: { url: "{{baseUrl}}/list.html" } },
      { id: "rows", type: "locator.css", config: { selector: "ul#items li" } },
      { id: "count", type: "locator.count", inputs: { locator: fromNode("rows", "locator") }, outputVariable: "rowCount" },
      { id: "loop", type: "control.foreach", inputs: { items: fromNode("count", "count") }, config: { maxIterations: 200 } },
      { id: "nth", type: "locator.nth", inputs: { locator: fromNode("rows", "locator"), index: fromVar("index") } },
      { id: "text", type: "element.innerText", inputs: { locator: fromNode("nth", "locator") } },
      { id: "store", type: "data.setVariable", config: { name: "result", scope: "current" }, inputs: { value: fromNode("text", "text") } },
      { id: "json", type: "data.jsonStringify", config: { pretty: true }, inputs: { value: fromNode("loop", "results") } },
      { id: "write", type: "integration.writeFile", config: { path: "items.json", contentType: "application/json" }, inputs: { content: fromNode("json", "text") } },
      { id: "ret", type: "control.return", inputs: { value: fromNode("loop", "results") } },
    ], [["start", "goto"], ["goto", "rows"], ["rows", "count"], ["count", "loop"], ["loop", "nth", "LOOP_BODY"], ["nth", "text"], ["text", "store"], ["loop", "json", "LOOP_DONE"], ["json", "write"], ["write", "ret"]]),
  },
  {
    id: "http-plus-page",
    name: "Combine HTTP API and page data",
    description: "Calls a JSON API, reads a page heading and combines both into a result.",
    category: "integration",
    definition: build("HTTP + page", "Combine API and browser results", [
      { id: "start", type: "control.start" },
      { id: "api", type: "integration.httpRequest", config: { method: "GET", url: "{{baseUrl}}/api.json", parseJson: true }, outputVariable: "api" },
      { id: "goto", type: "page.goto", config: { url: "{{baseUrl}}/index.html" } },
      { id: "heading", type: "element.innerText", config: { selector: "h1" }, outputVariable: "heading" },
      { id: "combine", type: "data.template", config: { template: "{{heading}} / api status {{api.status}} / version {{api.body.version}}" } },
      { id: "ret", type: "control.return", inputs: { value: fromNode("combine", "text") } },
    ], [["start", "api"], ["api", "goto"], ["goto", "heading"], ["heading", "combine"], ["combine", "ret"]]),
  },
  {
    id: "file-output",
    name: "Write results to a file",
    description: "Reads page text and writes it into a text artifact, then reads it back.",
    category: "files",
    definition: build("Write results to a file", "File output", [
      { id: "start", type: "control.start" },
      { id: "goto", type: "page.goto", config: { url: "{{baseUrl}}/index.html" } },
      { id: "text", type: "element.innerText", config: { selector: "main" } },
      { id: "write", type: "integration.writeFile", config: { path: "page.txt" }, inputs: { content: fromNode("text", "text") } },
      { id: "read", type: "integration.readFile", config: { path: "page.txt" } },
      { id: "ret", type: "control.return", inputs: { value: fromNode("read", "sizeBytes") } },
    ], [["start", "goto"], ["goto", "text"], ["text", "write"], ["write", "read"], ["read", "ret"]]),
  },
  {
    id: "conditional",
    name: "Conditional branch",
    description: "Checks whether a banner is visible and takes different actions on TRUE / FALSE.",
    category: "control",
    definition: build("Conditional branch", "If/else demo", [
      { id: "start", type: "control.start" },
      { id: "goto", type: "page.goto", config: { url: "{{baseUrl}}/index.html" } },
      { id: "visible", type: "element.isVisible", config: { selector: "#banner" } },
      { id: "if", type: "control.if", inputs: { condition: fromNode("visible", "visible") } },
      { id: "yes", type: "integration.notify", config: { level: "info", message: "Banner is visible" } },
      { id: "no", type: "integration.notify", config: { level: "warning", message: "Banner missing" } },
      { id: "retYes", type: "control.return", inputs: { value: lit("banner") } },
      { id: "retNo", type: "control.return", inputs: { value: lit("no-banner") } },
    ], [["start", "goto"], ["goto", "visible"], ["visible", "if"], ["if", "yes", "TRUE"], ["if", "no", "FALSE"], ["yes", "retYes"], ["no", "retNo"]]),
  },
  {
    id: "foreach-data",
    name: "Foreach over data with error handling",
    description: "Iterates a constant array, compares values, and demonstrates FOLLOW_ERROR_EDGE.",
    category: "control",
    definition: build("Foreach over data", "Pure data loop", [
      { id: "start", type: "control.start" },
      { id: "items", type: "data.constant", config: { value: ["alpha", "beta", "gamma"] } },
      { id: "loop", type: "control.foreach", inputs: { items: fromNode("items", "value") }, config: { maxIterations: 10 } },
      { id: "tpl", type: "data.template", config: { template: "{{index}}:{{item}}" } },
      { id: "save", type: "data.setVariable", config: { name: "result", scope: "current" }, inputs: { value: fromNode("tpl", "text") } },
      { id: "parse", type: "data.jsonParse", inputs: { text: lit("not json") }, errorPolicy: { mode: "FOLLOW_ERROR_EDGE" } },
      { id: "onErr", type: "integration.notify", config: { level: "warning", message: "Parse failed as expected: {{error.code}}" } },
      { id: "ret", type: "control.return", inputs: { value: fromNode("loop", "results") } },
    ], [["start", "items"], ["items", "loop"], ["loop", "tpl", "LOOP_BODY"], ["tpl", "save"], ["loop", "parse", "LOOP_DONE"], ["parse", "onErr", "ERROR"], ["onErr", "ret"]]),
  },
];
export function getTemplate(id: string): FlowTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
