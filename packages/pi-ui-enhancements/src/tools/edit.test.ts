import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { patchEditTool, parseDiffStats } from "./edit";
import { mkTheme, mkToolCtx, setupTool } from "../test-helpers";

function setupEditTool() {
  return setupTool(patchEditTool);
}

// Initialize a minimal theme so renderDiff works in expanded mode
const testTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  inverse: (text: string) => text,
  strikethrough: (text: string) => text,
  getFgAnsi: () => "",
  getBgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => (s: string) => s,
  getBashModeBorderColor: () => (s: string) => s,
} as unknown as Theme;

let savedTheme: Theme | undefined;

beforeAll(async () => {
  const themeMod =
    await import("../../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
  savedTheme = (themeMod as any).theme;
  themeMod.setThemeInstance(testTheme);
});

afterAll(async () => {
  const themeMod =
    await import("../../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
  if (savedTheme) {
    themeMod.setThemeInstance(savedTheme);
  }
});

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

describe("edit renderResult", () => {
  it("collapsed result shows diff stats", () => {
    const def = setupEditTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
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
        details: { diff },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("+2");
    expect(output).toContain("-1");
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
    expect(output).toContain("└─ ");
    expect(output).toContain("+new");
    expect(output).toContain("-old");
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
