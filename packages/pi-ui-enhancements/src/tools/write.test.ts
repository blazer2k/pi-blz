import { describe, expect, it } from "bun:test";
import { getConfig } from "../config";
import { patchWriteTool } from "./write";
import { mkTheme, mkToolCtx, setupTool } from "../test-helpers";

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

  it("expanded result previews up to maxExpandedEntries lines", () => {
    const def = setupWriteTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const maxEntries = getConfig().maxExpandedEntries;
    const totalLines = maxEntries + 5;
    const lines = Array.from(
      { length: totalLines },
      (_, i) => `L${String(i + 1).padStart(2, "0")}`,
    ).join("\n");
    const ctx = mkToolCtx({
      args: { path: "big.ts", content: lines },
    });

    const component = renderResult(
      {
        content: [{ type: "text", text: `wrote ${totalLines} lines` }],
        details: undefined,
      },
      { expanded: true, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain(`├─ ${totalLines} lines`);
    expect(output).toContain("L01");
    const lastVisible = String(maxEntries).padStart(2, "0");
    expect(output).toContain(`L${lastVisible}`);
    const nextLine = String(maxEntries + 1).padStart(2, "0");
    expect(output).not.toContain(`L${nextLine}`);
    expect(output).toContain("5 more lines");
  });
});
