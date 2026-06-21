import { describe, expect, it } from "bun:test";
import { patchReadTool } from "./read";
import { mkTheme, mkToolCtx, setupTool } from "../test-helpers";

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

  it("renders line range", () => {
    const def = setupReadTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall(
      { path: "src/index.ts", offset: 10, limit: 5 },
      theme,
      ctx,
    );

    const text = component.render(120).join("\n");
    expect(text).toContain(":10-14");
  });

  it("uses compact skill format for SKILL.md", () => {
    const def = setupReadTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const skillPath = `${process.cwd()}/some-skill/SKILL.md`;
    const component = renderCall({ path: skillPath }, theme, ctx);

    const text = component.render(120).join("\n");
    expect(text).toContain("[skill]");
    expect(text).toContain("some-skill");
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
    expect(output).toContain("truncated");
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
