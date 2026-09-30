import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { ExtensionRunner } from "@earendil-works/pi-coding-agent";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { getConfig, loadConfig, saveConfig } from "../../config/store";
import { cleanRunnerProto, mkTheme, mkToolCtx } from "../../testing/helpers";
import { clearBlinkTimers } from "../rendering/state";
import { patchCustomToolRendering } from "./patch-manager";
import { createWrappedDefinition } from "./definition-adapter";
import { stripAnsi } from "../rendering/text";

const originalConfigPath = process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
let configDir: string;

beforeEach(() => {
  cleanRunnerProto();
  configDir = mkdtempSync(join(tmpdir(), "pi-ui-custom-tools-"));
  process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = join(configDir, "settings.json");
  loadConfig();
  saveConfig("capitalizeToolNames", "false");
});

afterEach(() => {
  cleanRunnerProto();
  clearBlinkTimers();
  rmSync(configDir, { recursive: true, force: true });
  if (originalConfigPath === undefined) {
    delete process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  } else {
    process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = originalConfigPath;
  }
  loadConfig();
});

const proto = ExtensionRunner.prototype as unknown as Record<
  string | symbol,
  unknown
>;

function mkRegisteredTool(name: string) {
  const def: ToolDefinition = {
    name,
    label: name,
    description: `test ${name}`,
    parameters: {} as any,
    execute: async () => ({ content: [], details: undefined }),
  };
  return { definition: def, sourceInfo: undefined };
}

describe("wrapped custom tool definitions", () => {
  it("falls back to generic call rendering when original renderCall throws", () => {
    const tool = mkRegisteredTool("myTool");
    tool.definition.renderCall = () => {
      throw new Error("boom");
    };
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const issues: unknown[] = [];
    const handle = patchCustomToolRendering(undefined, (issue) =>
      issues.push(issue),
    );
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    const component = tools[0]!.definition.renderCall!(
      { value: 1 },
      mkTheme(),
      mkToolCtx(),
    );
    const rendered = component.render(80).join("\n");

    expect(rendered).toContain("myTool");
    expect(rendered).toContain("value=1");
    tools[0]!.definition.renderCall!({ value: 2 }, mkTheme(), mkToolCtx());
    expect(issues).toEqual([
      expect.objectContaining({ stage: "renderCall", toolName: "myTool" }),
    ]);
    handle.dispose();
  });

  it("preserves safe ANSI styling from original renderCall", () => {
    const tool = mkRegisteredTool("myTool");
    tool.definition.renderCall = (_args, theme) =>
      new Text(theme.fg("toolTitle", "search") + " query", 0, 0);
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) =>
        color === "toolTitle" ? `\x1b[35m${text}\x1b[39m` : text,
    } as Theme;

    const handle = patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    const component = tools[0]!.definition.renderCall!(
      { query: "query" },
      theme,
      mkToolCtx(),
    );
    const rendered = component.render(80).join("\n");

    expect(rendered).toContain("\x1b[35msearch\x1b[39m");
    handle.dispose();
  });

  it("keeps collapsed calls compact and preserves expanded multiline calls", () => {
    const tool = mkRegisteredTool("codemode").definition;
    const expansionFlags: boolean[] = [];
    tool.renderCall = (_args, _theme, context) => {
      expansionFlags.push(context.expanded);
      return new Text(
        `codemode\n\x1b[32mconst message = "${"x".repeat(160)}";\x1b[39m\n\n  return message;`,
        0,
        0,
      );
    };
    const wrapped = createWrappedDefinition(tool, {
      isToolCallActive: () => false,
      reportIssue: () => {},
    });
    const collapsed = wrapped.renderCall!({}, mkTheme(), mkToolCtx())
      .render(120)
      .map(stripAnsi);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toContain("...");
    expect(collapsed[0]).not.toContain("return message;");

    const expanded = wrapped.renderCall!(
      {},
      mkTheme(),
      mkToolCtx({ expanded: true }),
    );
    for (const width of [40, 80, 120]) {
      const rows = expanded.render(width);
      const plain = rows.map(stripAnsi);
      expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
      expect(plain[0]).toContain("codemode");
      expect(
        plain.slice(1).every((row) => row.trimStart().startsWith("│")),
      ).toBe(true);
      expect(plain.map((row) => row.trim())).toContain("│");
      expect(plain.join("\n")).toContain("│    return message;");
      expect(plain.join("\n").match(/x/g)).toHaveLength(160);
      expect(plain.join("\n")).not.toContain("...");
      expect(rows.join("\n")).toContain("\x1b[32m");
    }
    expect(expansionFlags).toEqual([false, true]);
  });

  it("preserves extra call content supplied by the native expanded renderer", () => {
    const tool = mkRegisteredTool("mcp").definition;
    tool.renderCall = (_args, _theme, context) =>
      new Text(context.expanded ? "mcp\n  full argument" : "mcp preview", 0, 0);
    const wrapped = createWrappedDefinition(tool, {
      isToolCallActive: () => false,
      reportIssue: () => {},
    });

    const collapsed = wrapped.renderCall!({}, mkTheme(), mkToolCtx())
      .render(80)
      .map(stripAnsi)
      .join("\n");
    const expanded = wrapped.renderCall!(
      {},
      mkTheme(),
      mkToolCtx({ expanded: true }),
    )
      .render(80)
      .map(stripAnsi)
      .join("\n");
    expect(collapsed).toContain("mcp preview");
    expect(collapsed).not.toContain("full argument");
    expect(expanded).toContain("│    full argument");
    expect(expanded).not.toContain("mcp preview");
  });

  it("trims padded original renderResult lines before adding tree prefixes", () => {
    const tool = mkRegisteredTool("myTool");
    tool.definition.renderResult = (_result, _options, theme) =>
      new Text(theme.fg("dim", "10 results"), 0, 0);
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const handle = patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    const component = tools[0]!.definition.renderResult!(
      { content: [], details: { status: "ok" } },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx(),
    );
    const rendered = component.render(80);
    const nonEmpty = rendered.filter((line) => line.trim().length > 0);

    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0]!.trim()).toBe("╰─ 10 results");
    handle.dispose();
  });

  it("falls back to generic result rendering when renderResult throws", () => {
    const tool = mkRegisteredTool("myTool");
    tool.definition.renderResult = () => {
      throw new Error("boom");
    };
    proto.getAllRegisteredTools = function () {
      return [tool];
    };
    const issues: unknown[] = [];
    const handle = patchCustomToolRendering(undefined, (issue) =>
      issues.push(issue),
    );
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    const component = tools[0]!.definition.renderResult!(
      { content: [{ type: "text", text: "one\ntwo" }], details: undefined },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx(),
    );

    expect(component.render(80).join("\n")).toContain("2 lines");
    expect(issues).toEqual([
      expect.objectContaining({ stage: "renderResult", toolName: "myTool" }),
    ]);
    handle.dispose();
  });

  it("uses empty-result formatting for blank custom output", () => {
    const tool = mkRegisteredTool("myTool");
    tool.definition.renderResult = () => new Text("   ", 0, 0);
    proto.getAllRegisteredTools = function () {
      return [tool];
    };
    const handle = patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    const component = tools[0]!.definition.renderResult!(
      { content: [], details: undefined },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx(),
    );

    expect(component.render(80).join("\n")).toContain("(no output)");
    handle.dispose();
  });

  it("does not schedule blink invalidation for wrapped custom calls", () => {
    const tool = mkRegisteredTool("myTool");
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const handle = patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;
    const state = {};

    tools[0]!.definition.renderCall!(
      {},
      mkTheme(),
      mkToolCtx({ state, isPartial: true, executionStarted: true }),
    );

    expect((state as any)._uiEnhancements.blinkTimer).toBeUndefined();
    handle.dispose();
  });

  it("schedules blink invalidation only for active custom calls", () => {
    const tool = mkRegisteredTool("myTool");
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const handle = patchCustomToolRendering(
      (toolCallId) => toolCallId === "call-1",
    );
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;
    const state = {};

    tools[0]!.definition.renderCall!(
      {},
      mkTheme(),
      mkToolCtx({ state, isPartial: true, executionStarted: true }),
    );

    expect((state as any)._uiEnhancements.blinkTimer).toBeDefined();
    clearBlinkTimers();
    handle.dispose();
  });

  it("marks generic results truncated from tool details", () => {
    const tool = mkRegisteredTool("myTool");
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const handle = patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;
    const state = {};
    const component = tools[0]!.definition.renderResult!(
      {
        content: [{ type: "text", text: "one\ntwo" }],
        details: { truncation: { truncated: true } },
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({ state }),
    );

    expect(component.render(80).join("\n")).toContain("truncated • 2 lines");
    expect(state).toEqual(
      expect.objectContaining({
        _uiEnhancements: expect.objectContaining({ truncated: true }),
      }),
    );
    handle.dispose();
  });

  it("shows truncation without error metadata before custom output", () => {
    const tool = mkRegisteredTool("myTool");
    tool.definition.renderResult = () => new Text("failure details", 0, 0);
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const handle = patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;
    const component = tools[0]!.definition.renderResult!(
      {
        content: [{ type: "text", text: "failure details" }],
        details: { truncation: { truncated: true } },
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({ isError: true }),
    );

    const output = component.render(80).join("\n");
    expect(output).toContain("truncated");
    expect(output).not.toContain("error •");
    handle.dispose();
  });

  it("capitalizes first character of original renderCall output when enabled", () => {
    saveConfig("capitalizeToolNames", "true");
    expect(getConfig().capitalizeToolNames).toBe(true);

    const tool = mkRegisteredTool("myTool");
    tool.definition.label = "My Tool";
    tool.definition.renderCall = (_args, theme) =>
      new Text(theme.fg("toolTitle", "search") + " latest news", 0, 0);
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const handle = patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    const component = tools[0]!.definition.renderCall!(
      { query: "latest news" },
      mkTheme(),
      mkToolCtx(),
    );
    const rendered = component.render(80).join(" ");

    // First visible character should be capitalized
    expect(rendered).toContain("Search");
    expect(rendered).not.toContain("search");

    handle.dispose();
  });

  it("capitalizes with ANSI-styled original renderCall output", () => {
    saveConfig("capitalizeToolNames", "true");

    const tool = mkRegisteredTool("myTool");
    tool.definition.label = "Web Search";
    tool.definition.renderCall = (_args, theme) =>
      new Text(
        theme.fg("toolTitle", "search") +
          " " +
          theme.fg("accent", "latest news"),
        0,
        0,
      );
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) =>
        color === "toolTitle"
          ? `\x1b[35m${text}\x1b[39m`
          : color === "accent"
            ? `\x1b[36m${text}\x1b[39m`
            : text,
    } as Theme;

    const handle = patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    const component = tools[0]!.definition.renderCall!(
      { query: "latest news" },
      theme,
      mkToolCtx(),
    );
    const rendered = component.render(80).join(" ");

    // Should capitalize first visible char and preserve ANSI codes
    expect(rendered).toContain("Search");
    expect(rendered).not.toContain("search");

    handle.dispose();
  });

  it("skips non-SGR and malformed escape sequences when capitalizing", () => {
    saveConfig("capitalizeToolNames", "true");

    const tool = mkRegisteredTool("myTool");
    tool.definition.renderCall = () => new Text("\x1b[?25l\x1bsearch", 0, 0);
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const handle = patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    const component = tools[0]!.definition.renderCall!(
      {},
      mkTheme(),
      mkToolCtx(),
    );
    const rendered = component.render(80).join(" ");

    expect(rendered).toContain("Search");

    handle.dispose();
  });

  it("does not capitalize when config is disabled", () => {
    saveConfig("capitalizeToolNames", "false");

    const tool = mkRegisteredTool("myTool");
    tool.definition.renderCall = (_args, theme) =>
      new Text(theme.fg("toolTitle", "search") + " latest news", 0, 0);
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const handle = patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    const component = tools[0]!.definition.renderCall!(
      { query: "latest news" },
      mkTheme(),
      mkToolCtx(),
    );
    const rendered = component.render(80).join(" ");

    expect(rendered).toContain("search");
    expect(rendered).not.toContain("Search");

    handle.dispose();
  });
});
