import { describe, expect, it } from "vitest";
import { isLiveOk, type LiveHealth } from "./health";

describe("health helper", () => {
  it("accepts ok payload", () => {
    const payload: LiveHealth = { status: "ok", service: "api" };
    expect(isLiveOk(payload)).toBe(true);
  });

  it("rejects missing or failed payload", () => {
    expect(isLiveOk(undefined)).toBe(false);
    expect(isLiveOk({ status: "fail" })).toBe(false);
  });
});
