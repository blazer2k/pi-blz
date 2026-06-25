import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { ExtensionRunner } from "@earendil-works/pi-coding-agent";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { patchCustomToolRendering } from "./custom-tool-rendering";
import {
  cleanRunnerProto,
  mkTheme,
  mkToolCtx,
  PATCH_REF_COUNT,
  PROTOTYPE_PATCHED,
} from "../test-helpers";

beforeEach(cleanRunnerProto);
afterEach(cleanRunnerProto);

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

describe("patchCustomToolRendering", () => {
  it("wraps non-builtin tools", () => {
    proto.getAllRegisteredTools = function () {
      return [mkRegisteredTool("myTool")];
    };

    const handle = patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as unknown[];

    expect(
      (tools[0] as { definition: { renderShell?: string } }).definition
        .renderShell,
    ).toBe("self");
    handle.dispose();
  });

  it("does not wrap built-in tools", () => {
    const tool = mkRegisteredTool("read");
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as unknown[];

    expect((tools[0] as typeof tool).definition).toBe(tool.definition);
  });

  it("does not double-wrap already wrapped tools", () => {
    const tool = mkRegisteredTool("myTool");
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    patchCustomToolRendering();
    const getter = proto.getAllRegisteredTools as Function;
    const first = getter.call({} as any) as unknown[];
    const second = getter.call({} as any) as unknown[];

    // definition-level cache: same wrapped definition reused
    expect((first[0] as { definition: unknown }).definition).toBe(
      (second[0] as { definition: unknown }).definition,
    );
  });

  it("dispose restores original prototype method", () => {
    const original = function () {
      return [];
    };
    proto.getAllRegisteredTools = original;

    const handle = patchCustomToolRendering();
    expect(proto.getAllRegisteredTools).not.toBe(original);

    handle.dispose();
    expect(proto.getAllRegisteredTools).toBe(original);
  });

  it("reference counting keeps patch until final dispose", () => {
    const original = function () {
      return [mkRegisteredTool("myTool")];
    };
    proto.getAllRegisteredTools = original;

    const h1 = patchCustomToolRendering();
    const h2 = patchCustomToolRendering();

    // Both active - still patched
    expect(proto.getAllRegisteredTools).not.toBe(original);
    expect(proto[PATCH_REF_COUNT]).toBe(2);

    // Dispose first - still patched
    h1.dispose();
    expect(proto.getAllRegisteredTools).not.toBe(original);
    expect(proto[PATCH_REF_COUNT]).toBe(1);

    // Dispose second - restored
    h2.dispose();
    expect(proto.getAllRegisteredTools).toBe(original);
    expect(proto[PROTOTYPE_PATCHED]).toBeUndefined();
  });

  it("falls back to generic call rendering when original renderCall throws", () => {
    const tool = mkRegisteredTool("myTool");
    tool.definition.renderCall = () => {
      throw new Error("boom");
    };
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const handle = patchCustomToolRendering();
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
    expect(nonEmpty[0]!.trim()).toBe("└─ 10 results");
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

    expect(component.render(80).join("\n")).toContain("2 lines");
    expect(state).toEqual(
      expect.objectContaining({
        _uiEnhancements: expect.objectContaining({ truncated: true }),
      }),
    );
    handle.dispose();
  });

  it("disabled patch stops wrapping even when another patch is chained after it", () => {
    const original = function () {
      return [mkRegisteredTool("myTool")];
    };
    proto.getAllRegisteredTools = original;

    const handle = patchCustomToolRendering();
    const patched = proto.getAllRegisteredTools as Function;
    proto.getAllRegisteredTools = function () {
      return patched.call(this);
    };

    handle.dispose();

    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    expect(tools[0]!.definition.renderShell).toBeUndefined();
  });
});
