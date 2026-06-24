import { describe, expect, it } from "bun:test";
import { patchLsTool } from "./ls";
import { patchFindTool } from "./find";
import { patchGrepTool } from "./grep";
import { mkTheme, mkToolCtx, setupTool } from "../test-helpers";

function setupLsTool() {
  return setupTool(patchLsTool);
}

function setupFindTool() {
  return setupTool(patchFindTool);
}

function setupGrepTool() {
  return setupTool(patchGrepTool);
}

// --- ls ---

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

  it("renders limit suffix", () => {
    const def = setupLsTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall({ path: ".", limit: 50 }, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("(limit 50)");
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
  it("reports entry count", () => {
    const def = setupLsTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "a.txt\nb/\nc.md" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );
    const output = component.render(120).join("\n");
    expect(output).toContain("3 entries");
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

// --- find ---

describe("find renderCall", () => {
  it("renders pattern", () => {
    const def = setupFindTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall({ pattern: "*.ts" }, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("Find");
    expect(text).toContain("*.ts");
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

  it("renders limit suffix", () => {
    const def = setupFindTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall({ pattern: "*.ts", limit: 100 }, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("(limit 100)");
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

// --- grep ---

describe("grep renderCall", () => {
  it("renders pattern", () => {
    const def = setupGrepTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall({ pattern: "TODO" }, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("Grep");
    expect(text).toContain("TODO");
  });

  it("renders glob filter", () => {
    const def = setupGrepTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall({ pattern: "TODO", glob: "*.ts" }, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("TODO");
    expect(text).toContain("*.ts");
  });

  it("renders context lines", () => {
    const def = setupGrepTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall({ pattern: "TODO", context: 3 }, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("±3");
  });

  it("renders limit suffix", () => {
    const def = setupGrepTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderCall({ pattern: "TODO", limit: 500 }, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("(limit 500)");
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
