import { describe, expect, it } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { patchGrepTool } from "./grep";
import { mkTheme, mkToolCtx, setupTool } from "../test-helpers";

function setupGrepTool() {
  return setupTool(patchGrepTool);
}

function mkColorTheme(): Theme {
  return {
    ...mkTheme(),
    fg: (color: string, text: string) => `${color}:${text}`,
  } as Theme;
}

describe("grep renderCall", () => {
  it("renders pattern as accent", () => {
    const def = setupGrepTool();
    const renderCall = def.renderCall!;
    const ctx = mkToolCtx();

    const component = renderCall({ pattern: "TODO" }, mkColorTheme(), ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("Grep");
    expect(text).toContain("accent:TODO");
  });

  it("renders additional parameters as dim", () => {
    const def = setupGrepTool();
    const renderCall = def.renderCall!;
    const ctx = mkToolCtx();

    const component = renderCall(
      { pattern: "TODO", glob: "*.ts", context: 3, limit: 500 },
      mkColorTheme(),
      ctx,
    );
    const text = component.render(120).join("\n");
    expect(text).toContain("dim: *.ts");
    expect(text).toContain("dim: ±3");
    expect(text).toContain("dim: (limit 500)");
  });

  it("expands and wraps a truncated pattern", () => {
    const def = setupGrepTool();
    const state = {};
    const pattern = `prefix-${"y".repeat(100)}-pattern-tail`;
    const args = { pattern, path: "/tmp", glob: "*.ts", context: 2 };
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
    const def = setupGrepTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ isPartial: true, argsComplete: false });

    const component = renderCall({}, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("Grep");
    expect(text).toContain("...");
  });
});

describe("grep renderResult", () => {
  it("reports line count", () => {
    const def = setupGrepTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "a.ts:1:TODO\nb.ts:2:TODO" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );
    const output = component.render(120).join("\n");
    expect(output).toContain("2 lines");
  });

  it("renders no matches message", () => {
    const def = setupGrepTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "No matches found" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );
    const output = component.render(120).join("\n");
    expect(output).toContain("No matches found");
  });

  it("marks linesTruncated as truncated", () => {
    const def = setupGrepTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "a.ts:1:match" }],
        details: { linesTruncated: true },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );
    const output = component.render(120).join("\n");
    expect(output).toContain("truncated");
  });
});
