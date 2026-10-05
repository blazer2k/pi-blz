import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, spyOn } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolRendererResolver,
} from "@earendil-works/pi-coding-agent";
import { ExtensionRunner } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { mkTheme, mkToolCtx } from "./testing/helpers";
import ext from "./index";
import { loadConfig } from "./config/store";
import { isFullscreenTui } from "./tools/rendering/tui-runtime";

function mkPi() {
  const registeredTools: string[] = [];
  const registeredToolDefinitions: Array<
    Parameters<ExtensionAPI["registerTool"]>[0]
  > = [];
  const resolvers: ToolRendererResolver[] = [];
  const entries: Array<{ type: "custom"; customType: string; data: unknown }> =
    [];
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
    registerToolRenderer: (resolver: ToolRendererResolver) =>
      resolvers.push(resolver),
    getAllTools: () =>
      ["read", "write", "edit", "bash", "ls", "find", "grep"].map((name) => ({
        name,
        sourceInfo: { source: "builtin", path: `builtin:${name}` },
      })),
    registerCommand: () => {},
    appendEntry: (customType: string, data: unknown) =>
      entries.push({ type: "custom", customType, data }),
    getActiveTools: () => [...activeTools],
    setActiveTools: (tools: string[]) => {
      activeToolsArg = tools;
    },
    getThinkingLevel: () => "off",
    // Test helpers
    _handlers: handlers,
    _registeredTools: () => registeredTools,
    _registeredToolDefinitions: () => registeredToolDefinitions,
    _resolve: (name: string) => resolvers[0]!(name, () => ({}))!,
    _resolverCount: () => resolvers.length,
    _entries: () => entries,
    _setActiveToolsArg: () => activeToolsArg,
    _setActiveTools: (tools: string[]) => {
      activeTools.push(...tools);
    },
  } as unknown as ExtensionAPI & {
    _handlers: Record<string, Array<(...args: unknown[]) => void>>;
    _registeredTools: () => string[];
    _resolve: (name: string) => ReturnType<ToolRendererResolver>;
    _resolverCount: () => number;
    _entries: () => Array<{
      type: "custom";
      customType: string;
      data: unknown;
    }>;
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
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget: overrides?.ui?.setWidget ?? (() => {}),
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
  it("keeps core renderers without Codemode registration or the hook when disabled", () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-ui-codemode-lifecycle-"));
    const originalPath = process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
    process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = join(
      directory,
      "settings.json",
    );
    writeFileSync(
      process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH,
      JSON.stringify({ patchCustomTools: false }),
    );
    const pi = mkPi();
    const registryMethod = ExtensionRunner.prototype.getAllRegisteredTools;
    try {
      ext(pi);
      expect(ExtensionRunner.prototype.getAllRegisteredTools).toBe(
        registryMethod,
      );
      expect(pi._resolverCount()).toBe(1);
      expect(pi._registeredTools()).toEqual([]);
      expect(pi._registeredTools()).not.toContain("codemode");
      expect(pi._resolve("bash")?.renderShell).toBe("self");
      pi._handlers.session_start![0]!(
        {},
        mkCtx({ mode: "json", hasUI: false }),
      );
      expect(ExtensionRunner.prototype.getAllRegisteredTools).toBe(
        registryMethod,
      );
    } finally {
      pi._handlers.session_shutdown?.[0]?.({});
      if (originalPath === undefined)
        delete process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
      else process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = originalPath;
      rmSync(directory, { recursive: true, force: true });
      loadConfig();
    }
  });
  it("session_start does not override active tools", () => {
    const pi = mkPi();
    (pi as any)._setActiveTools(["custom"]);

    ext(pi);

    const ctx = mkCtx();
    const handler = (pi as any)._handlers.session_start[0];
    handler({} as any, ctx);

    expect((pi as any)._setActiveToolsArg()).toBeUndefined();
  });

  it("session_start skips UI enhancements outside TUI mode", () => {
    const pi = mkPi();
    ext(pi);

    let editorSet = false;
    let workingSet = false;
    const ctx = mkCtx({
      mode: "json",
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

  it("session_start registers UI enhancements in TUI mode", () => {
    const pi = mkPi();
    ext(pi);

    let editorSet = false;
    const ctx = mkCtx({
      hasUI: true,
      ui: {
        setWidget: () => {},
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

  for (const mode of ["rpc", "json", "print"] as const) {
    it(`does not capture a TUI in ${mode} mode`, async () => {
      const pi = mkPi();
      ext(pi);
      const ctx = mkCtx({ mode, hasUI: mode === "rpc" });
      let widgetSet = false;
      ctx.ui.setWidget = () => {
        widgetSet = true;
      };
      try {
        await pi._handlers.session_start![0]!({}, ctx);
        expect(widgetSet).toBe(false);
        expect(isFullscreenTui()).toBe(false);
      } finally {
        await pi._handlers.session_shutdown![0]!({});
      }
    });
  }

  it("captures before the editor and clears capture on shutdown and reinstall", async () => {
    const pi = mkPi();
    ext(pi);
    const widgets = new Map<string, { dispose?(): void }>();
    const tui = { mode: "fullscreen", requestRender() {} } as TUI;
    const ctx = mkCtx({ mode: "tui" });
    let editorRegistrations = 0;
    ctx.ui.setWidget = (key, content) => {
      widgets.get(key)?.dispose?.();
      widgets.delete(key);
      if (typeof content === "function")
        widgets.set(key, content(tui, mkTheme()));
    };
    ctx.ui.setEditorComponent = () => {
      expect(isFullscreenTui()).toBe(true);
      editorRegistrations++;
    };
    try {
      for (let session = 0; session < 2; session++) {
        await pi._handlers.session_start![0]!({}, ctx);
        expect(isFullscreenTui()).toBe(true);
        expect(widgets.size).toBe(1);
        await pi._handlers.session_shutdown![0]!({});
        expect(widgets.size).toBe(0);
        expect(isFullscreenTui()).toBe(false);
      }
      expect(editorRegistrations).toBe(2);
    } finally {
      await pi._handlers.session_shutdown![0]!({});
    }
  });

  it("session_shutdown disposes all handles", () => {
    const pi = mkPi();
    ext(pi);

    const ctx = mkCtx();
    const startHandler = (pi as any)._handlers.session_start[0];
    startHandler({} as any, ctx);

    const registeredBefore = (pi as any)._registeredTools();
    expect(registeredBefore).toEqual([]);
    expect(pi._resolverCount()).toBe(1);

    // Trigger shutdown
    const shutdownHandler = (pi as any)._handlers.session_shutdown[0];
    shutdownHandler({} as any);

    expect(pi._resolve("bash")?.renderShell).toBeUndefined();
    expect(pi._resolverCount()).toBe(1);
  });

  for (const isError of [false, true]) {
    it(`uses execution-event timing without wrapping Bash execute, isError=${isError}`, async () => {
      const pi = mkPi();
      const clock = spyOn(Date, "now").mockReturnValue(1000);
      ext(pi);
      try {
        const renderer = pi._resolve("bash")!;
        const context = mkToolCtx({ args: { command: "echo result" } });
        await pi._handlers.tool_execution_start![0]!({
          toolCallId: "call-1",
          toolName: "bash",
        });
        clock.mockReturnValue(2250);
        await pi._handlers.tool_execution_end![0]!({
          toolCallId: "call-1",
          toolName: "bash",
        });
        const output = renderer.renderResult!(
          {
            content: [
              { type: "text", text: isError ? "Command aborted" : "result" },
            ],
            details: undefined,
          },
          { expanded: false, isPartial: false },
          mkTheme(),
          { ...context, isError },
        )
          .render(80)
          .join("\n");
        expect(output).toContain("took 1.3s");
        expect(pi._registeredTools()).toEqual([]);
      } finally {
        await pi._handlers.session_shutdown![0]!({});
        clock.mockRestore();
      }
    });
  }

  it("keeps Bash durations across history rebuilds and restores only valid branch timing records", async () => {
    const pi = mkPi();
    const clock = spyOn(Date, "now").mockReturnValue(1000);
    ext(pi);
    const ctx = mkCtx({ mode: "json", hasUI: false });
    ctx.sessionManager.getBranch = () =>
      pi._entries() as ReturnType<typeof ctx.sessionManager.getBranch>;
    const render = () =>
      pi._resolve("bash")!.renderResult!(
        { content: [{ type: "text", text: "result" }], details: undefined },
        { expanded: false, isPartial: false },
        mkTheme(),
        mkToolCtx({ executionStarted: false }),
      )
        .render(80)
        .join("\n");
    try {
      await pi._handlers.tool_execution_start![0]!({
        toolCallId: "call-1",
        toolName: "bash",
      });
      clock.mockReturnValue(2250);
      await pi._handlers.tool_execution_end![0]!({
        toolCallId: "call-1",
        toolName: "bash",
      });
      expect(pi._entries()).toEqual([
        {
          type: "custom",
          customType: "pi-ui-enhancements:bash-timing",
          data: { toolCallId: "call-1", durationMs: 1250 },
        },
      ]);
      for (let rebuild = 0; rebuild < 2; rebuild++)
        expect(render()).toContain("took 1.3s");
      await pi._handlers.session_shutdown![0]!({});
      pi._entries().push({
        type: "custom",
        customType: "pi-ui-enhancements:bash-timing",
        data: { toolCallId: "call-1", durationMs: -10 },
      });
      await pi._handlers.session_start![0]!({}, ctx);
      expect(render()).toContain("took 1.3s");
      const historical = mkToolCtx({ executionStarted: false });
      pi._resolve("bash")!.renderCall!(
        { command: "echo result" },
        mkTheme(),
        historical,
      ).render(80);
      expect(
        (historical.state as { startedAt?: number }).startedAt,
      ).toBeUndefined();
      expect((historical.state as { durationMs?: number }).durationMs).toBe(
        1250,
      );
    } finally {
      await pi._handlers.session_shutdown![0]!({});
      clock.mockRestore();
    }
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

      const bashTool = pi._resolve("bash")!;
      expect(pi._resolverCount()).toBe(1);

      bashTool.renderResult!(
        { content: [{ type: "text", text: "running" }], details: undefined },
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
