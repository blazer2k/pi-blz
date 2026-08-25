import { describe, expect, it } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { patchWriteTool } from "./write";
import { getBlinkIndicator } from "./rendering/state";
import { mkTheme, mkToolCtx, setupTool } from "../testing/helpers";

function setupWriteTool() {
  return setupTool(patchWriteTool);
}

describe("write renderCall", () => {
  it("renders path", () => {
    const def = setupWriteTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall(
      { path: "a.ts", content: "const x = 1;" },
      theme,
      ctx,
    );

    const text = component.render(120).join("\n");
    expect(text).toContain("Write");
    expect(text).toContain("a.ts");
  });

  it("expands a truncated path and hints even when content is empty", () => {
    const def = setupWriteTool();
    const state = {};
    const path = `/tmp/${"segment/".repeat(12)}target.txt`;
    const args = { path, content: "" };
    const collapsedCtx = mkToolCtx({ state, args });
    const collapsed = def.renderCall!(args, mkTheme(), collapsedCtx)
      .render(120)
      .join("\n");
    expect(collapsed).toContain("...");

    const collapsedResult = def.renderResult!(
      {
        content: [{ type: "text", text: "wrote 0 bytes" }],
        details: undefined,
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

  it("partial call includes preview/result summary", () => {
    const def = setupWriteTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ isPartial: true });

    const component = renderCall(
      { path: "b.ts", content: "line1\nline2\nline3" },
      theme,
      ctx,
    );

    const text = component.render(120).join("\n");
    expect(text).toContain("b.ts");
    expect(text).toContain("3 lines");
  });

  it("partial empty content has no expansion hint or empty preview row", () => {
    const def = setupWriteTool();
    const component = def.renderCall!(
      { path: "empty.ts", content: "" },
      mkTheme(),
      mkToolCtx({ isPartial: true, expanded: true }),
    );
    const output = component.render(120).join("\n");

    expect(output).toContain("╰─ 0 lines");
    expect(output).not.toContain("ctrl+o");
  });

  it("expanded partial call without path still previews content", () => {
    const def = setupWriteTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ isPartial: true, expanded: true });

    const component = renderCall(
      { content: "line1\nline2\nline3" },
      theme,
      ctx,
    );

    const text = component.render(120).join("\n");
    expect(text).toContain("3 lines");
    expect(text).toContain("line1");
  });
});

describe("write renderResult", () => {
  it("collapsed result reports content line count", () => {
    const def = setupWriteTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx({
      args: { path: "a.ts", content: "line1\nline2" },
    });

    const component = renderResult(
      {
        content: [{ type: "text", text: "wrote 2 lines" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("2 lines");
    expect(output).toContain("to expand");
  });

  it("keeps empty results on one non-expandable row", () => {
    const def = setupWriteTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();

    for (const expanded of [false, true]) {
      const component = renderResult(
        {
          content: [{ type: "text", text: "wrote 0 bytes" }],
          details: undefined,
        },
        { expanded, isPartial: false },
        theme,
        mkToolCtx({ args: { path: "empty.ts", content: "" } }),
      );
      const lines = component
        .render(120)
        .map((line) => line.trim())
        .filter(Boolean);

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("╰─ 0 lines");
      expect(lines[0]).not.toContain("ctrl+o");
    }
  });

  it("puts truncation before line metadata when collapsed and expanded", () => {
    const def = setupWriteTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();

    for (const expanded of [false, true]) {
      const ctx = mkToolCtx({
        args: { path: "a.ts", content: "line1\nline2" },
      });
      const component = renderResult(
        {
          content: [{ type: "text", text: "wrote 2 lines" }],
          details: { truncation: { truncated: true } },
        },
        { expanded, isPartial: false },
        theme,
        ctx,
      );

      expect(component.render(120).join("\n")).toContain("truncated • 2 lines");
    }
  });

  it("expanded result renders every content line with metadata last", () => {
    const def = setupWriteTool();
    const totalLines = 25;
    const lines = Array.from(
      { length: totalLines },
      (_, i) => `L${String(i + 1).padStart(2, "0")}`,
    ).join("\n");
    const ctx = mkToolCtx({
      args: { path: "big.ts", content: lines },
    });

    const component = def.renderResult!(
      {
        content: [{ type: "text", text: `wrote ${totalLines} lines` }],
        details: undefined,
      },
      { expanded: true, isPartial: false },
      mkTheme(),
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("L01");
    expect(output).toContain("L25");
    expect(output).not.toContain("hidden lines");
    expect(output.split("\n").at(-1)).toContain(`╰─ ${totalLines} lines`);
  });

  it("preserves prior highlighted lines across append-only partial updates", () => {
    const def = setupWriteTool();
    const state = {};
    const ctx = mkToolCtx({ expanded: true, isPartial: true, state });
    const theme = mkTheme();

    def.renderCall!(
      { path: "append.ts", content: "const first = 1;" },
      theme,
      ctx,
    );
    const updated = def.renderCall!(
      {
        path: "append.ts",
        content: "const first = 1;\nconst second = 2;",
      },
      theme,
      ctx,
    )
      .render(120)
      .join("\n");

    expect(updated).toContain("const first");
    expect(updated).toContain("const second");
    expect(updated.split("\n").at(-1)).toContain("╰─ 2 lines");
  });

  it("uses a static accent indicator while expanded and success when done", () => {
    const def = setupWriteTool();
    const state = {};
    const args = { path: "status.txt", content: "done" };
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const activeCtx = mkToolCtx({
      args,
      expanded: true,
      isPartial: true,
      state,
    });

    const active = def.renderCall!(args, theme, activeCtx)
      .render(120)
      .join("\n");
    expect(active).toContain(`accent:${getBlinkIndicator().unfilled}`);
    expect((state as { blinkTimer?: unknown }).blinkTimer).toBeUndefined();

    def.renderResult!(
      {
        content: [{ type: "text", text: "wrote 1 line" }],
        details: undefined,
      },
      { expanded: true, isPartial: false },
      theme,
      activeCtx,
    );
    const completed = def.renderCall!(args, theme, {
      ...activeCtx,
      isPartial: false,
    })
      .render(120)
      .join("\n");
    expect(completed).toContain(`success:${getBlinkIndicator().filled}`);
  });
});
