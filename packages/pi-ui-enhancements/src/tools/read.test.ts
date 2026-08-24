import { describe, expect, it } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { patchReadTool } from "./read";
import { mkTheme, mkToolCtx, setupTool } from "../test-helpers";
import { PI_0_84_2_OUTPUT } from "./test-fixtures/pi-0.84.2";

function setupReadTool() {
  return setupTool(patchReadTool);
}

describe("read renderCall", () => {
  it("renders normal path", () => {
    const def = setupReadTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall({ path: "src/index.ts" }, theme, ctx);

    const text = component.render(120).join("\n");
    expect(text).toContain("Read");
    expect(text).toContain("src/index.ts");
  });

  it("renders line range as dim", () => {
    const def = setupReadTool();
    const renderCall = def.renderCall!;
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const ctx = mkToolCtx();

    const component = renderCall(
      { path: "src/index.ts", offset: 10, limit: 5 },
      theme,
      ctx,
    );

    const text = component.render(120).join("\n");
    expect(text).toContain("dim::10-14");
  });

  it("expands a truncated path and adds call-driven result hints", () => {
    const def = setupReadTool();
    const state = {};
    const path = `/tmp/${"segment/".repeat(12)}target.txt`;
    const args = { path };
    const collapsedCtx = mkToolCtx({ state, args });
    const collapsed = def.renderCall!(args, mkTheme(), collapsedCtx)
      .render(120)
      .join("\n");
    expect(collapsed).toContain("...");

    const collapsedResult = def.renderResult!(
      {
        content: [{ type: "text", text: "line1\nline2" }],
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

    const expandedResult = def.renderResult!(
      {
        content: [{ type: "text", text: "line1\nline2" }],
        details: undefined,
      },
      { expanded: true, isPartial: false },
      mkTheme(),
      expandedCtx,
    );
    expect(expandedResult.render(120).join("\n")).toContain("to collapse");
  });

  it("uses compact skill format for SKILL.md and expands to its full path", () => {
    const def = setupReadTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const skillPath = `${process.cwd()}/some-skill/SKILL.md`;
    const component = renderCall({ path: skillPath }, theme, ctx);

    const text = component.render(120).join("\n");
    expect(text).toContain("[skill]");
    expect(text).toContain("some-skill");

    const expanded = renderCall({ path: skillPath }, theme, {
      ...ctx,
      expanded: true,
    })
      .render(50)
      .join("\n");
    expect(expanded).toContain("Read");
    expect(expanded).toContain("SKILL.md");
    expect(expanded).not.toContain("[skill]");
  });
});

describe("read renderResult", () => {
  it("reports text line count", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "line1\nline2\nline3" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("3 lines");
  });

  it("excludes continuation notices from text line counts", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: `line1\nline2\nline3\nline4\n\n${PI_0_84_2_OUTPUT.read.moreLines}`,
          },
        ],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx(),
    );

    expect(component.render(120).join("\n")).toContain("4 lines");
  });

  it("counts tool-truncated content without its generated footer", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: `line1\nline2\n\n${PI_0_84_2_OUTPUT.read.showingLines}`,
          },
        ],
        details: { truncation: { truncated: true } },
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx(),
    );

    expect(component.render(120).join("\n")).toContain("truncated • 2 lines");
  });

  it("does not strip ordinary bracketed file content", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const component = renderResult(
      {
        content: [{ type: "text", text: "line1\n\n[ordinary note]" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx(),
    );

    expect(component.render(120).join("\n")).toContain("3 lines");
  });

  it("reports image dimensions", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [
          { type: "image", data: "image-data", mimeType: "image/png" },
          { type: "text", text: "original 640x480" },
        ],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("Image (640x480)");
  });

  it("reports image processing failures instead of text lines", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: "Read image file [image/png]\n[Image omitted: resize failed.]",
          },
        ],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      mkToolCtx(),
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("├─ warning:Image unavailable");
    expect(output).toContain("╰─ muted:Image omitted: resize failed.");
    expect(output).not.toContain("2 lines");
  });

  it("keeps the image warning style when the reason wraps", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const warningOpen = "\x1b[33m";
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => {
        const open =
          color === "warning"
            ? warningOpen
            : color === "muted"
              ? "\x1b[90m"
              : color === "dim"
                ? "\x1b[2m"
                : "";
        return `${open}${text}\x1b[0m`;
      },
    } as Theme;
    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: "Read image file [image/png]\n[Image omitted: could not be resized below the inline image size limit.]",
          },
        ],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      mkToolCtx(),
    );

    const warningLine = component
      .render(45)
      .find((line) => line.includes("Image unavailable"));
    expect(warningLine).toContain(`${warningOpen}Image unavailable`);
  });

  it("marks truncation", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "line1\nline2" }],
        details: { truncation: { truncated: true } },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("truncated • 2 lines");
  });

  it("reports no content when empty", () => {
    const def = setupReadTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("no content");
  });
});
