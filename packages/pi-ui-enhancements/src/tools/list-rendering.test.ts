import { describe, expect, it } from "bun:test";
import { mkTheme } from "../test-helpers";
import { buildPatternPathCall, splitNativeListOutput } from "./list-rendering";

describe("splitNativeListOutput", () => {
  it("removes Pi's trailing truncation notice", () => {
    expect(
      splitNativeListOutput("src/a.ts\nsrc/b.ts\n\n[Showing first 2 results]"),
    ).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("keeps ordinary output unchanged", () => {
    expect(splitNativeListOutput("src/a.ts\nsrc/b.ts")).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});

describe("buildPatternPathCall", () => {
  it("keeps full text while marking a compact pattern as lossy", () => {
    const pattern = `prefix-${"x".repeat(100)}-tail`;
    const call = buildPatternPathCall({
      prefix: "● ",
      title: "Find ",
      pattern,
      path: "src",
      cwd: "/repo",
      theme: mkTheme(),
    });

    expect(call.collapsedText).toContain("...");
    expect(call.fullText).toContain("-tail");
    expect(call.compactIsLossy).toBe(true);
  });
});
