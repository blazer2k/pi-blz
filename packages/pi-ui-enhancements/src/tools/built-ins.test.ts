import { describe, expect, it } from "bun:test";
import { patchTools } from "./built-ins";

describe("core renderer bundles", () => {
  it("contains only presentation overrides for all seven supported core tools", () => {
    const bundles = patchTools();
    expect([...bundles.keys()]).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      "ls",
      "find",
      "grep",
    ]);
    for (const bundle of bundles.values()) {
      expect(Object.keys(bundle).sort()).toEqual([
        "renderCall",
        "renderResult",
        "renderShell",
      ]);
      expect(bundle.renderShell).toBe("self");
      expect(typeof bundle.renderCall).toBe("function");
      expect(typeof bundle.renderResult).toBe("function");
    }
  });
});
