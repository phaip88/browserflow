import { describe, it, expect } from "vitest";
import { NODE_CATALOG, NODE_REGISTRY_VERSION } from "@/nodes/catalog";
import { NODE_IMPLEMENTATIONS } from "@/nodes/impl";
import { fieldsToZod } from "@/flow/schema";

/** Contract tests: every catalog entry must have an implementation and consistent metadata. */
describe("node contracts", () => {
  const REQUIRED_TYPES = ["control.start","control.end","control.if","control.foreach","control.wait","control.fail","control.return","page.goto","page.reload","page.title","page.url","page.screenshot","page.waitForURL","page.waitForLoadState","locator.css","locator.text","locator.role","locator.first","locator.nth","locator.count","locator.waitFor","element.click","element.fill","element.press","element.selectOption","element.check","element.innerText","element.textContent","element.getAttribute","element.isVisible","data.constant","data.setVariable","data.getVariable","data.template","data.jsonParse","data.jsonStringify","data.compare","data.randomString","integration.httpRequest","integration.readFile","integration.writeFile","integration.notify"];
  it("ships all 42 Release 1 node types", () => {
    const types = NODE_CATALOG.map((n) => n.type);
    for (const t of REQUIRED_TYPES) expect(types).toContain(t);
    expect(NODE_REGISTRY_VERSION).toMatch(/^r1\./);
  });
  for (const meta of NODE_CATALOG) {
    it(`${meta.type} satisfies the SDK contract`, () => {
      expect(typeof NODE_IMPLEMENTATIONS[meta.type]).toBe("function");
      expect(meta.version).toBeGreaterThanOrEqual(1);
      expect(meta.displayName.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.defaultTimeoutMs).toBeGreaterThan(0);
      expect(["none", "read", "write", "external"]).toContain(meta.sideEffectLevel);
      expect(Array.isArray(meta.requiredCapabilities)).toBe(true);
      const schema = fieldsToZod(meta.fields);
      const defaults: Record<string, unknown> = {};
      for (const f of meta.fields) if (f.default !== undefined) defaults[f.name] = f.default;
      const required = meta.fields.filter((f) => f.required && f.default === undefined);
      if (required.length === 0) expect(schema.safeParse(defaults).success).toBe(true);
      for (const sf of meta.sensitiveFields) expect(meta.fields.some((f) => f.name === sf) || meta.inputs.some((i) => i.name === sf)).toBe(true);
      for (const p of [...meta.inputs, ...meta.outputs]) expect(["page", "locator", "string", "number", "boolean", "json", "any"]).toContain(p.type);
      if (meta.category === "page" || meta.category === "locator" || meta.category === "element") expect(meta.requiredCapabilities).toContain("browser");
      if (meta.allowSelectorFallback) expect(meta.fields.some((f) => f.name === "selector")).toBe(true);
    });
  }
  it("has no implementation without catalog entry", () => {
    const types = new Set(NODE_CATALOG.map((n) => n.type));
    for (const k of Object.keys(NODE_IMPLEMENTATIONS)) expect(types.has(k), k).toBe(true);
  });
});
