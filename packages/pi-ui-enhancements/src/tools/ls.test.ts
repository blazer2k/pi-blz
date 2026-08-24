import { describe, expect, it } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { patchLsTool } from "./ls";
import { mkTheme, mkToolCtx, setupTool } from "../testing/helpers";

function setupLsTool() {
  return setupTool(patchLsTool);
}

function mkColorTheme(): Theme {
  return {
    ...mkTheme(),
    fg: (color: string, text: string) => `${color}:${text}`,
  } as Theme;
}

describe("ls renderCall", () => {
  it("renders path", () => {
    const def = setupLsTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall({ path: "src" }, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("Ls");
    expect(text).toContain("src");
  });

  it("renders limit suffix as dim", () => {
    const def = setupLsTool();
    const renderCall = def.renderCall!;
    const ctx = mkToolCtx();

    const component = renderCall({ path: ".", limit: 50 }, mkColorTheme(), ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("dim: (limit 50)");
  });

  it("expands and wraps a truncated path with result hints", () => {
    const def = setupLsTool();
    const state = {};
    const path = `/tmp/${"segment/".repeat(12)}target`;
    const collapsedCtx = mkToolCtx({ state, args: { path } });
    const collapsed = def.renderCall!({ path }, mkTheme(), collapsedCtx)
      .render(120)
      .join("\n");
    expect(collapsed).toContain("...");

    const collapsedResult = def.renderResult!(
      {
        content: [{ type: "text", text: "(empty directory)" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      collapsedCtx,
    );
    expect(collapsedResult.render(120).join("\n")).toContain("to expand");

    const expandedCtx = mkToolCtx({ expanded: true, state, args: { path } });
    const expanded = def.renderCall!({ path }, mkTheme(), expandedCtx)
      .render(40)
      .join("\n");
    expect(expanded).toContain("segment");
    expect(expanded).toContain("│  ");

    const expandedResult = def.renderResult!(
      {
        content: [{ type: "text", text: "(empty directory)" }],
        details: undefined,
      },
      { expanded: true, isPartial: false },
      mkTheme(),
      expandedCtx,
    );
    expect(expandedResult.render(120).join("\n")).toContain("to collapse");
  });

  it("defaults path to dot", () => {
    const def = setupLsTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall({}, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain(".");
  });
});

describe("ls renderResult", () => {
  it("reports entry count and renders directories as tool output", () => {
    const def = setupLsTool();
    const renderResult = def.renderResult!;
    const theme = mkColorTheme();
    const ctx = mkToolCtx({ expanded: true });

    const component = renderResult(
      {
        content: [{ type: "text", text: "a.txt\nb/\nc.md" }],
        details: undefined,
      },
      { expanded: true, isPartial: false },
      theme,
      ctx,
    );
    const output = component.render(120).join("\n");
    expect(output).toContain("3 entries");
    expect(output).toContain("toolOutput:b/");
    expect(output).not.toContain("success:b/");
  });

  it("renders empty directory message", () => {
    const def = setupLsTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "(empty directory)" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );
    const output = component.render(120).join("\n");
    expect(output).toContain("(empty directory)");
  });
});
