import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { ExtensionRunner } from "@earendil-works/pi-coding-agent";
import { mkTheme, mkToolCtx } from "./test-helpers";
import ext from "./index";
import { cleanRunnerProto, PROTOTYPE_PATCHED } from "./test-helpers";

beforeEach(cleanRunnerProto);
afterEach(cleanRunnerProto);

function mkPi() {
  const registeredTools: string[] = [];
  const registeredToolDefinitions: Array<
    Parameters<ExtensionAPI["registerTool"]>[0]
  > = [];
  const activeTools: string[] = [];
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  let activeToolsArg: string[] | undefined;

  return {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
    },
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => {
      registeredTools.push(tool.name);
      registeredToolDefinitions.push(tool);
    },
    registerCommand: () => {},
    getActiveTools: () => [...activeTools],
    setActiveTools: (tools: string[]) => {
      activeToolsArg = tools;
    },
    getThinkingLevel: () => "off",
    // Test helpers
    _handlers: handlers,
    _registeredTools: () => registeredTools,
    _registeredToolDefinitions: () => registeredToolDefinitions,
    _setActiveToolsArg: () => activeToolsArg,
    _setActiveTools: (tools: string[]) => {
      activeTools.push(...tools);
    },
  } as unknown as ExtensionAPI & {
    _handlers: Record<string, Array<(...args: unknown[]) => void>>;
    _registeredTools: () => string[];
    _registeredToolDefinitions: () => Array<
      Parameters<ExtensionAPI["registerTool"]>[0]
    >;
    _setActiveToolsArg: () => string[] | undefined;
    _setActiveTools: (tools: string[]) => void;
  };
}

function mkCtx(overrides?: Partial<ExtensionContext>) {
  return {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      setEditorComponent: overrides?.ui?.setEditorComponent ?? (() => {}),
      getEditorComponent:
        overrides?.ui?.getEditorComponent ?? (() => undefined),
      setFooter: overrides?.ui?.setFooter ?? (() => {}),
      setWorkingIndicator: overrides?.ui?.setWorkingIndicator ?? (() => {}),
      setWorkingMessage: overrides?.ui?.setWorkingMessage ?? (() => {}),
      setHeader: overrides?.ui?.setHeader ?? (() => {}),
      setHiddenThinkingLabel:
        overrides?.ui?.setHiddenThinkingLabel ?? (() => {}),
      theme: {
        fg: () => "",
        getFgAnsi: () => "",
        getColorMode: () => "truecolor",
        getThinkingBorderColor: () => () => "",
        getBashModeBorderColor: () => () => "",
      },
      notify: () => {},
    },
    sessionManager: {
      getEntries: () => [],
      getBranch: () => [],
    },
    getContextUsage: () => undefined,
    model: undefined,
    ...overrides,
  } as unknown as ExtensionContext;
}

describe("extension lifecycle", () => {
  it("session_start does not override active tools", () => {
    const pi = mkPi();
    (pi as any)._setActiveTools(["custom"]);

    ext(pi);

    const ctx = mkCtx();
    const handler = (pi as any)._handlers.session_start[0];
    handler({} as any, ctx);

    expect((pi as any)._setActiveToolsArg()).toBeUndefined();
  });

  it("session_start skips UI enhancements when hasUI is false", () => {
    const pi = mkPi();
    ext(pi);

    let editorSet = false;
    let workingSet = false;
    const ctx = mkCtx({
      hasUI: false,
      ui: {
        setEditorComponent: () => {
          editorSet = true;
        },
        setWorkingIndicator: () => {
          workingSet = true;
        },
      } as any,
    });

    const handler = (pi as any)._handlers.session_start[0];
    handler({} as any, ctx);

    expect(editorSet).toBe(false);
    expect(workingSet).toBe(false);
  });

  it("session_start registers UI enhancements when hasUI is true", () => {
    const pi = mkPi();
    ext(pi);

    let editorSet = false;
    const ctx = mkCtx({
      hasUI: true,
      ui: {
        setEditorComponent: () => {
          editorSet = true;
        },
        getEditorComponent: () => undefined,
        setFooter: () => {},
        setWorkingIndicator: () => {},
        setWorkingMessage: () => {},
        setHeader: () => {},
        setHiddenThinkingLabel: () => {},
        theme: {
          fg: () => "",
          getFgAnsi: () => "",
          getColorMode: () => "truecolor",
          getThinkingBorderColor: () => () => "",
          getBashModeBorderColor: () => () => "",
        },
        notify: () => {},
      } as any,
    });

    const handler = (pi as any)._handlers.session_start[0];
    handler({} as any, ctx);

    // Rounded editor calls setEditorComponent directly
    expect(editorSet).toBe(true);
    // Working indicator registers agent_start/agent_end handlers
    expect((pi as any)._handlers.agent_start).toBeDefined();
    expect((pi as any)._handlers.agent_end).toBeDefined();
  });

  it("session_shutdown disposes all handles", () => {
    const pi = mkPi();
    ext(pi);

    const ctx = mkCtx();
    const startHandler = (pi as any)._handlers.session_start[0];
    startHandler({} as any, ctx);

    const registeredBefore = (pi as any)._registeredTools();
    expect(registeredBefore.length).toBeGreaterThan(0);

    // Trigger shutdown
    const shutdownHandler = (pi as any)._handlers.session_shutdown[0];
    shutdownHandler({} as any);

    // The custom tool rendering patch should be disposed
    const proto = ExtensionRunner.prototype as unknown as Record<
      string | symbol,
      unknown
    >;
    expect(proto[PROTOTYPE_PATCHED]).toBeUndefined();
  });

  it("session_shutdown clears tool timers on later sessions", () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const timer = { id: "timer" } as unknown as ReturnType<typeof setInterval>;
    const cleared: unknown[] = [];

    globalThis.setInterval = (() => timer) as unknown as typeof setInterval;
    globalThis.clearInterval = ((id: unknown) => {
      cleared.push(id);
    }) as typeof clearInterval;

    try {
      const pi = mkPi();
      ext(pi);

      const ctx = mkCtx();
      const startHandler = (pi as any)._handlers.session_start[0];
      const shutdownHandler = (pi as any)._handlers.session_shutdown[0];

      startHandler({} as any, ctx);
      shutdownHandler({} as any);
      startHandler({} as any, ctx);

      const bashTool = (pi as any)
        ._registeredToolDefinitions()
        .find((tool: { name: string }) => tool.name === "bash");

      bashTool.renderResult(
        { content: [{ type: "text", text: "running" }] },
        { expanded: false, isPartial: true },
        mkTheme(),
        mkToolCtx({ state: { startedAt: Date.now() } }),
      );

      shutdownHandler({} as any);

      expect(cleared).toContain(timer);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });
});
