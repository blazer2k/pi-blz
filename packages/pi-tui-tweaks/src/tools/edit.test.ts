import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { patchEditTool, parseDiffStats } from "./edit";
import { clearBlinkTimers } from "./rendering/state";
import { stripAnsi } from "./rendering/text";
import { mkTheme, mkToolCtx, setupTool } from "../testing/helpers";

function setupEditTool() {
  return setupTool(patchEditTool);
}

beforeEach(() => initTheme("dark", false));
afterEach(() => clearBlinkTimers());

describe("parseDiffStats", () => {
  it("ignores file headers", () => {
    const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
`;
    const { added, removed } = parseDiffStats(diff);
    expect(added).toBe(1);
    expect(removed).toBe(1);
  });
});

describe("edit renderCall", () => {
  it("expands a truncated path and hints when there is no diff", () => {
    const def = setupEditTool();
    const state = {};
    const path = `/tmp/${"segment/".repeat(12)}target.txt`;
    const args = { path, oldText: "old", newText: "new" };
    const collapsedCtx = mkToolCtx({ state, args });
    const collapsed = def.renderCall!(args, mkTheme(), collapsedCtx)
      .render(120)
      .join("\n");
    expect(collapsed).toContain("...");

    const collapsedResult = def.renderResult!(
      {
        content: [{ type: "text", text: "edited" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      collapsedCtx,
    );
    expect(collapsedResult.render(120).join("\n")).toContain("to expand");

    const expandedCtx = mkToolCtx({ expanded: true, state, args });
    const expanded = def.renderCall!(args, mkTheme(), expandedCtx)
      .render(40)
      .join("\n");
    expect(expanded).toContain("segment");
    expect(expanded).toContain("│  ");
  });
});

describe("edit renderResult", () => {
  it("collapsed result shows stats in dedicated diff colors", () => {
    const def = setupEditTool();
    const renderResult = def.renderResult!;
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const ctx = mkToolCtx();

    const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,2 +1,3 @@
 line1
+added1
+added2
-removed1
`;
    const component = renderResult(
      {
        content: [{ type: "text", text: "edited" }],
        details: { diff, truncation: { truncated: true } },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("truncated");
    expect(output).toContain("toolDiffAdded:+2");
    expect(output).toContain("toolDiffRemoved:-1");
    expect(output).toContain("to expand");
  });

  it("expanded result renders diff tree", () => {
    const def = setupEditTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,2 +1,2 @@
 line1
-old
+new
`;
    const component = renderResult(
      {
        content: [{ type: "text", text: "edited" }],
        details: { diff },
      },
      { expanded: true, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("│  ");
    expect(output).toContain("╰─ ");
    expect(output).toContain("╰─ +1 -1");
    expect(stripAnsi(output)).toContain("+new");
    expect(stripAnsi(output)).toContain("-old");
  });

  it("handles missing diff", () => {
    const def = setupEditTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "edited" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("no diff");
  });
});
