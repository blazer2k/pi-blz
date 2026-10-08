import { describe, expect, it } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { patchFindTool } from "./find";
import { mkTheme, mkToolCtx, setupTool } from "../testing/helpers";

function setupFindTool() {
  return setupTool(patchFindTool);
}

function mkColorTheme(): Theme {
  return {
    ...mkTheme(),
    fg: (color: string, text: string) => `${color}:${text}`,
  } as Theme;
}

describe("find renderCall", () => {
  it("renders pattern as accent", () => {
    const def = setupFindTool();
    const renderCall = def.renderCall!;
    const ctx = mkToolCtx();

    const component = renderCall({ pattern: "*.ts" }, mkColorTheme(), ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("Find");
    expect(text).toContain("accent:*.ts");
  });

  it("renders pattern and path", () => {
    const def = setupFindTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall(
      { pattern: "*.test.ts", path: "src" },
      theme,
      ctx,
    );
    const text = component.render(120).join("\n");
    expect(text).toContain("*.test.ts");
    expect(text).toContain("src");
  });

  it("renders limit suffix as dim", () => {
    const def = setupFindTool();
    const renderCall = def.renderCall!;
    const ctx = mkToolCtx();

    const component = renderCall(
      { pattern: "*.ts", limit: 100 },
      mkColorTheme(),
      ctx,
    );
    const text = component.render(120).join("\n");
    expect(text).toContain("dim: (limit 100)");
  });

  it("expands and wraps a truncated pattern", () => {
    const def = setupFindTool();
    const state = {};
    const pattern = `prefix-${"x".repeat(100)}-pattern-tail`;
    const args = { pattern, path: "/tmp" };
    const collapsedCtx = mkToolCtx({ state, args });
    const collapsed = def.renderCall!(args, mkTheme(), collapsedCtx)
      .render(120)
      .join("\n");
    expect(collapsed).toContain("...");
    expect(collapsed).not.toContain("pattern-tail");

    const expandedCtx = mkToolCtx({ expanded: true, state, args });
    const expanded = def.renderCall!(args, mkTheme(), expandedCtx)
      .render(40)
      .join("\n");
    expect(expanded).toContain("pattern-tail");
    expect(expanded).toContain("│  ");
  });

  it("renders incomplete partial args without throwing", () => {
    const def = setupFindTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ isPartial: true, argsComplete: false });

    const component = renderCall({}, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("Find");
    expect(text).toContain("...");
  });
});

describe("find renderResult", () => {
  it("reports file count", () => {
    const def = setupFindTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "a.ts\nb.ts\nc.ts" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );
    const output = component.render(120).join("\n");
    expect(output).toContain("3 files");
  });

  it("renders no files message", () => {
    const def = setupFindTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "No files found matching pattern" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );
    const output = component.render(120).join("\n");
    expect(output).toContain("No files found matching pattern");
  });
});
