import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createAgentSession,
  CustomEditor,
  FooterComponent,
  InteractiveMode,
  createCodemodeExtension,
  createMcpExtension,
  initTheme,
  DefaultResourceLoader,
  ExtensionRunner,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  ToolExecutionComponent,
  type AgentSession,
  type ExtensionAPI,
  type ExtensionFactory,
  type ExtensionToolContext,
  type ExtensionUIContext,
  type KeybindingsManager,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
  getCapabilities,
  isAppleTerminalSession,
  Image,
  Container,
  visibleWidth,
  setCapabilities,
  Text,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import extension from "../index";
import { getConfig, loadConfig } from "../config/store";
import { stripAnsi } from "./rendering/text";
import { mkTheme, mkToolCtx, writeTestConfig } from "../testing/helpers";

const originalPath = process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
let directory: string;
const sessions: AgentSession[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-ui-renderer-ownership-"));
  process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = join(directory, "ui.json");
  loadConfig();
  initTheme("dark", false);
});
afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "quit",
    });
    session.dispose();
  }
  rmSync(directory, { recursive: true, force: true });
  if (originalPath === undefined)
    delete process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  else process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = originalPath;
  loadConfig();
});

async function createSession(
  enhanced: boolean,
  tools?: string[],
  sessionManager?: SessionManager,
  extensionFactories: ExtensionFactory[] = enhanced ? [extension] : [],
  bindings: Parameters<AgentSession["bindExtensions"]>[0] = { mode: "json" },
) {
  const createTransport = mock(() => {
    throw new Error("Offline rendering tests must not connect to MCP");
  });
  const settingsManager = SettingsManager.inMemory({ defaultTools: ["read"] });
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      {
        name: "codemode",
        builtin: true,
        replaceable: true,
        factory: createCodemodeExtension(),
      },
      {
        name: "mcp",
        builtin: true,
        replaceable: true,
        factory: createMcpExtension({
          loadConfig: () => ({ servers: [], errors: [] }),
          createTransport,
        }),
      },
      ...extensionFactories,
    ],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({
    authPath: join(directory, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(directory, "models.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    resourceLoader,
    modelRuntime,
    sessionManager:
      sessionManager ??
      SessionManager.create(directory, join(directory, "sessions")),
    tools,
  });
  sessions.push(session);
  await session.bindExtensions(bindings);
  return { session, resourceLoader, createTransport };
}

function resolve(session: AgentSession, name: string) {
  return session.extensionRunner.resolveToolRenderers(name, () =>
    session.getToolDefinition(name),
  );
}

function toolComponent(
  session: AgentSession,
  name: string,
  args: Record<string, unknown>,
  id = name,
) {
  return new ToolExecutionComponent(
    name,
    id,
    args,
    { showImages: true },
    resolve(session, name),
    { requestRender() {} } as TUI,
    directory,
  );
}

async function exportData(session: AgentSession) {
  const html = readFileSync(
    await session.exportToHtml(join(directory, "export.html")),
    "utf8",
  );
  const encoded =
    /<script id="session-data" type="application\/json">([^<]*)<\/script>/.exec(
      html,
    )?.[1];
  expect(encoded).toBeDefined();
  return JSON.parse(Buffer.from(encoded!, "base64").toString("utf8")) as {
    renderedTools: Record<
      string,
      {
        callHtml?: string;
        resultHtmlCollapsed?: string;
        resultHtmlExpanded?: string;
      }
    >;
  };
}

describe("public renderer integration", () => {
  it("loads externally edited settings only after Pi reloads and registers no settings command", async () => {
    let header: (Component & { dispose?(): void }) | undefined;
    const errors: unknown[] = [];
    const uiContext = {
      setHeader(factory: Parameters<ExtensionUIContext["setHeader"]>[0]) {
        header?.dispose?.();
        header = factory?.({} as TUI, mkTheme());
      },
      setWidget() {},
      setEditorComponent() {},
      getEditorComponent: () => undefined,
      setFooter() {},
      setStatus() {},
      setWorkingIndicator() {},
      setWorkingMessage() {},
      setWorkingVisible() {},
      setHiddenThinkingLabel() {},
      notify: (message: string) => errors.push(message),
    } as unknown as ExtensionUIContext;
    const { session, resourceLoader, createTransport } = await createSession(
      true,
      undefined,
      undefined,
      [extension],
      {
        mode: "tui",
        uiContext,
        onError: (error) => errors.push(error),
      },
    );
    const initialHeader = header!.render(80);
    const commands = () =>
      resourceLoader
        .getExtensions()
        .extensions.flatMap((entry) => [...entry.commands.keys()]);
    expect(commands()).not.toContain("ui-settings");
    const initial = getConfig();
    const inventory = session.getAllTools().map((tool) => tool.name);
    const active = session.getActiveToolNames();
    const args = { command: "echo config" };
    const result = {
      content: [{ type: "text" as const, text: "first\nsecond\nthird\nlast" }],
      details: {},
      durationMs: 1,
      isError: false,
    };
    const component = toolComponent(session, "bash", args);
    component.setArgsComplete();
    component.updateResult(result);
    const before = component.render(80);
    expect(before.map(stripAnsi).join("\n")).toContain("Bash $ echo config");
    expect(before.map(stripAnsi).join("\n")).toContain("│  first");
    const updates = {
      capitalizeToolNames: false,
      collapsedOutputDisplay: "summary",
      indicatorStyle: "diamond",
      headerMode: "large",
      headerAlign: "center",
      editorColor: "muted",
    } as const;
    writeFileSync(
      process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH!,
      JSON.stringify({ ...initial, ...updates }),
    );
    expect(getConfig()).toEqual(initial);
    component.invalidate();
    expect(component.render(80)).toEqual(before);
    header!.invalidate();
    expect(header!.render(80)).toEqual(initialHeader);

    await session.reload();
    expect(getConfig()).toEqual({ ...initial, ...updates });
    expect(header!.render(80)).not.toEqual(initialHeader);
    expect(header!.render(80).map(stripAnsi)).toContain(
      isAppleTerminalSession()
        ? " ".repeat(39) + "Pi"
        : " ".repeat(36) + "██████  ",
    );
    expect(commands()).not.toContain("ui-settings");
    const rebuilt = toolComponent(session, "bash", args);
    rebuilt.setArgsComplete();
    rebuilt.updateResult(result);
    const after = rebuilt.render(80).map(stripAnsi).join("\n");
    expect(after).toContain("◆ bash $ echo config");
    expect(after).toContain("4 lines");
    expect(after).not.toContain("│  first");
    expect(session.getAllTools().map((tool) => tool.name)).toEqual(inventory);
    expect(session.getActiveToolNames()).toEqual(active);
    for (const headerMode of ["native", "off", "compact"] as const) {
      writeFileSync(
        process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH!,
        JSON.stringify({ ...getConfig(), headerMode }),
      );
      await session.reload();
      expect(getConfig().headerMode).toBe(headerMode);
      if (headerMode === "native") expect(header).toBeUndefined();
      else if (headerMode === "off") expect(header!.render(80)).toEqual([]);
      else
        expect(header!.render(80).map(stripAnsi)).toContain(
          isAppleTerminalSession()
            ? " ".repeat(39) + "Pi"
            : " ".repeat(38) + "▀▀█ ",
        );
    }
    expect(errors).toEqual([]);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("reloads all editor styles with real Pi editor/footer setters and native embedded Working", async () => {
    const { session, createTransport } = await createSession(true);
    const errors: unknown[] = [];
    const statuses = new Map([["offline", "offline status"]]);
    let branchSubscriptions = 0;
    const footerData = {
      getGitBranch: () => "main",
      getExtensionStatuses: () => statuses,
      getAvailableProviderCount: () => 1,
      onBranchChange() {
        branchSubscriptions++;
        return () => {
          branchSubscriptions--;
        };
      },
    } as ConstructorParameters<typeof FooterComponent>[1];
    const tui = {
      terminal: { rows: 24 },
      requestRender() {},
      setFocus() {},
      getClearOnShrink: () => false,
    } as unknown as TUI;
    const editorTheme = {
      borderColor: (text: string) => text,
      selectList: {},
    } as ConstructorParameters<typeof CustomEditor>[1];
    const keybindings = {
      matches: () => false,
    } as unknown as KeybindingsManager;
    const native = new CustomEditor(tui, editorTheme, keybindings, {
      paddingX: 2,
      autocompleteMaxVisible: 7,
      embedWorkingStatus: true,
    });
    native.setText("draft 界 input");
    const nativeFooter = new FooterComponent(session, footerData);
    const host = Object.assign(Object.create(InteractiveMode.prototype), {
      ui: tui,
      runtimeHost: { session },
      defaultEditor: native,
      editor: native,
      editorContainer: new Container(),
      footerContainer: new Container(),
      statusContainer: new Container(),
      footer: nativeFooter,
      footerDataProvider: footerData,
      options: { tuiMode: "regular" },
      defaultWorkingMessage: "Native Working",
      disposeActiveSelector() {},
    });
    host.editorContainer.addChild(native);
    host.footerContainer.addChild(nativeFooter);
    const workingOptions: Array<
      Parameters<ExtensionUIContext["setWorkingIndicator"]>[0]
    > = [];
    const uiContext = {
      theme: { ...mkTheme(), getColorMode: () => "256color" },
      setHeader() {},
      setWidget() {},
      setHiddenThinkingLabel() {},
      setEditorComponent: (
        factory: Parameters<ExtensionUIContext["setEditorComponent"]>[0],
      ) => host.setCustomEditorComponent(factory),
      getEditorComponent: () => host.editorComponentFactory,
      setFooter: (factory: Parameters<ExtensionUIContext["setFooter"]>[0]) =>
        host.setExtensionFooter(factory),
      setWorkingIndicator(
        options: Parameters<ExtensionUIContext["setWorkingIndicator"]>[0],
      ) {
        workingOptions.push(options);
        host.setWorkingIndicator(options);
      },
      setWorkingMessage(message?: string) {
        host.workingMessage = message;
        host.activeStatusIndicator?.setMessage(
          message ?? host.defaultWorkingMessage,
        );
      },
      notify: (message: string) => errors.push(message),
    } as unknown as ExtensionUIContext;
    await session.bindExtensions({
      mode: "tui",
      uiContext,
      onError: (error) => errors.push(error),
    });
    const inventory = session.getAllTools().map((tool) => tool.name);
    const active = session.getActiveToolNames();
    const nativeFooterLines = nativeFooter.render(120);
    try {
      for (const editorStyle of [
        "rounded",
        "compact",
        "native",
        "rounded",
        "native",
        "compact",
      ] as const) {
        const beforeEditor = host.editor;
        const beforeConfig = getConfig();
        writeFileSync(
          process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH!,
          JSON.stringify({
            ...beforeConfig,
            editorStyle,
            editorColor: "muted",
            editorShowThinkingLevel: false,
            editorShowCacheTokens: false,
            editorShowCost: false,
            editorShowBranch: false,
            workingIndicatorShowDuration: false,
            workingIndicatorShowInterruptMsg: false,
          }),
        );
        expect(host.editor).toBe(beforeEditor);
        expect(getConfig()).toEqual(beforeConfig);
        await session.reload();
        expect(errors).toEqual([]);
        expect(getConfig().editorStyle).toBe(editorStyle);
        expect(host.editor.getText()).toBe("draft 界 input");
        expect(host.editor.getPaddingX()).toBe(2);
        expect(host.editor.getAutocompleteMaxVisible()).toBe(7);
        expect(session.getAllTools().map((tool) => tool.name)).toEqual(
          inventory,
        );
        expect(session.getActiveToolNames()).toEqual(active);
        expect(branchSubscriptions).toBe(editorStyle === "native" ? 0 : 1);
        if (editorStyle === "native") {
          expect(host.editor).toBe(native);
          expect(host.editor.embedWorkingStatus).toBe(true);
          expect(host.customFooter).toBeUndefined();
          expect(host.footerContainer.render(120)).toEqual(nativeFooterLines);
          expect(
            host.footerContainer.render(120).map(stripAnsi).join("\n"),
          ).toContain("(main)");
          expect(host.footerContainer.render(80).map(stripAnsi).at(-1)).toBe(
            "offline status",
          );
          expect(host.workingIndicatorOptions).toBeUndefined();
        } else {
          expect(host.editor).not.toBe(native);
          expect(host.editor.embedWorkingStatus).toBe(false);
          expect(host.footerContainer.render(80).map(stripAnsi)).toEqual([
            "",
            "offline status",
          ]);
          const rows = host.editor.render(120).map(stripAnsi);
          expect(rows[0]).toContain(directory);
          expect(rows[0]).not.toContain("(main)");
          expect(rows[0]!.startsWith("╭")).toBe(editorStyle === "rounded");
          expect(rows.at(-1)!.startsWith("╰─")).toBe(editorStyle === "rounded");
          if (editorStyle === "compact")
            expect(rows.join("\n")).not.toMatch(/[╭╮╰╯│]/u);
        }
        host.showWorkingStatusIndicator();
        const count = workingOptions.length;
        await session.extensionRunner.emit({ type: "agent_start" });
        expect(errors).toEqual([]);
        if (editorStyle === "native") {
          expect(workingOptions).toHaveLength(count);
          expect(host.statusContainer.children).toHaveLength(0);
          expect(stripAnsi(host.editor.render(80)[0]!)).toContain(
            "Native Working",
          );
        } else {
          expect(host.statusContainer.children).toHaveLength(1);
          expect(stripAnsi(host.editor.render(80)[0]!)).not.toContain(
            "Working",
          );
          expect(stripAnsi(host.workingIndicatorOptions.frames[0])).toBe(
            "Working",
          );
        }
      }
      const replacement = () => new CustomEditor(tui, editorTheme, keybindings);
      host.setCustomEditorComponent(replacement);
      host.setExtensionFooter(() => new Text("other footer", 0, 0));
      await session.extensionRunner.emit({
        type: "session_shutdown",
        reason: "reload",
      });
      expect(host.editorComponentFactory).toBe(replacement);
      expect(host.footerContainer.render(80)).toEqual([
        "other footer".padEnd(80),
      ]);
      expect(branchSubscriptions).toBe(0);
      expect(errors).toEqual([]);
      expect(createTransport).not.toHaveBeenCalled();
    } finally {
      host.clearStatusIndicator();
      nativeFooter.dispose();
    }
  });

  it("composes real extension resolvers around the enhancement without taking over self-owned shells", async () => {
    const trace: string[] = [];
    let beforeResult: ToolRenderers | undefined;
    let afterResult: ToolRenderers | undefined;
    const downstream: ToolRenderers = {
      renderCall: () => new Text("Downstream wording", 0, 0),
    };
    const before: ExtensionFactory = (pi) => {
      pi.registerToolRenderer((_name, next) => {
        trace.push("before:enter");
        beforeResult = next();
        trace.push("before:exit");
        return beforeResult;
      });
    };
    const after: ExtensionFactory = (pi) => {
      for (const name of ["composed", "self_owned"]) {
        pi.registerTool({
          name,
          label: name,
          description: name,
          parameters: Type.Object({}),
          execute: async () => ({ content: [], details: undefined }),
          renderShell: name === "self_owned" ? "self" : "default",
          renderCall: () => new Text("Registered wording", 0, 0),
        });
      }
      pi.registerToolRenderer((name, next) => {
        trace.push("after:enter");
        const base = next();
        afterResult = name === "composed" ? downstream : base;
        trace.push("after:exit");
        return afterResult;
      });
    };
    const { session } = await createSession(true, undefined, undefined, [
      before,
      extension,
      after,
    ]);
    for (const name of ["composed", "self_owned", "missing"]) {
      trace.length = 0;
      const base = session.getToolDefinition(name) ?? downstream;
      const resolved = session.extensionRunner.resolveToolRenderers(
        name,
        () => {
          trace.push("base");
          return base;
        },
      );
      expect(trace).toEqual([
        "before:enter",
        "after:enter",
        "base",
        "after:exit",
        "before:exit",
      ]);
      expect(resolved).toBe(beforeResult);
      if (name === "composed") {
        expect(afterResult).toBe(downstream);
        expect(resolved!.renderShell).toBe("self");
        expect(resolved!.renderCall).not.toBe(downstream.renderCall);
        expect(
          resolved!.renderCall!({}, mkTheme(), mkToolCtx())
            .render(80)
            .join("\n"),
        ).toContain("Downstream wording");
      } else {
        expect(afterResult).toBe(base);
        expect(resolved).toBe(base);
      }
    }
  });

  it("renders disconnected MCP history and exports like native Pi, then uses a later local registration", async () => {
    const name = "mcp__offline__query";
    const id = "disconnected-history";
    const args = { query: "history only" };
    const result = {
      content: [
        {
          type: "text" as const,
          text: "offline first\nmiddle one\nmiddle two\nmiddle three\nmiddle four\noffline last",
        },
      ],
      details: { server: "offline", tool: "query" },
      isError: false,
    };
    let baseline:
      | {
          terminal: string[][];
          html: Awaited<ReturnType<typeof exportData>>["renderedTools"][string];
        }
      | undefined;
    const originalWrapping = getConfig().patchCustomTools;
    try {
      for (const mode of ["native", "unwrapped", "wrapped"]) {
        const enhanced = mode !== "native";
        writeTestConfig({ patchCustomTools: mode === "wrapped" });
        let pi!: ExtensionAPI;
        const fixture = await createSession(enhanced, undefined, undefined, [
          ...(enhanced ? [extension] : []),
          (api) => {
            pi = api;
          },
        ]);
        const { session } = fixture;
        const inventory = session.getAllTools();
        const active = session.getActiveToolNames();
        expect(session.getToolDefinition(name)).toBeUndefined();
        expect(pi.getMcpServers()).toEqual([]);
        session.sessionManager.appendMessage({
          role: "user",
          content: "offline history",
          timestamp: 1,
        });
        session.sessionManager.appendMessage({
          role: "assistant",
          content: [{ type: "toolCall", id, name, arguments: args }],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "offline",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "toolUse",
          timestamp: 1,
        });
        session.sessionManager.appendMessage({
          role: "toolResult",
          toolCallId: id,
          toolName: name,
          ...result,
          timestamp: 2,
        });
        const history = structuredClone(
          session.sessionManager.buildSessionContext().messages,
        );
        const component = toolComponent(session, name, args, id);
        component.setArgsComplete();
        component.updateResult(result);
        const terminal: string[][] = [];
        for (const expanded of [false, true]) {
          component.setExpanded(expanded);
          const lines = component.render(80);
          const visible = lines.map(stripAnsi).join("\n");
          expect(visible).toContain("offline/query");
          expect(visible).toContain("history only");
          expect(visible).toContain("offline first");
          expect(visible.includes("offline last")).toBe(expanded);
          terminal.push(lines);
        }
        const html = (await exportData(session)).renderedTools[id]!;
        expect(html.callHtml).toContain("offline/query");
        expect(html.resultHtmlCollapsed).toContain("offline first");
        expect(html.resultHtmlExpanded).toContain("offline last");
        if (!baseline) baseline = { terminal, html };
        else expect({ terminal, html }).toEqual(baseline);
        expect(session.getAllTools()).toEqual(inventory);
        expect(session.getActiveToolNames()).toEqual(active);
        expect(session.getToolDefinition(name)).toBeUndefined();
        expect(session.sessionManager.buildSessionContext().messages).toEqual(
          history,
        );
        expect(fixture.createTransport).not.toHaveBeenCalled();

        const local = {
          name,
          label: "Local query",
          description: "Offline synthetic definition",
          parameters: Type.Object({ query: Type.String() }),
          exposure: "deferred" as const,
          execute: async () => ({ content: [], details: undefined }),
          renderCall: () => new Text("Local renderer", 0, 0),
        };
        pi.registerTool(local);
        expect(session.getToolDefinition(name)).toBe(local);
        expect(session.getActiveToolNames()).toEqual(active);
        const later = toolComponent(session, name, args, id)
          .render(80)
          .map(stripAnsi)
          .join("\n");
        expect(later).toContain("Local renderer");
        expect(later).not.toContain("offline/query");
        expect(resolve(session, name)!.renderShell === "self").toBe(
          mode === "wrapped",
        );
        expect(fixture.createTransport).not.toHaveBeenCalled();
      }
    } finally {
      writeTestConfig({ patchCustomTools: originalWrapping });
    }
  });

  it("preserves one native PNG and reuses native components through partial/final updates and expansion", async () => {
    const capabilities = getCapabilities();
    const originalWrapping = getConfig().patchCustomTools;
    const png = {
      type: "image" as const,
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=",
    };
    const partial = {
      content: [{ type: "text" as const, text: "partial image" }, png],
      details: undefined,
      isError: false,
    };
    const final = {
      content: [{ type: "text" as const, text: "final image" }, png],
      details: undefined,
      isError: false,
    };
    const snapshots = structuredClone([partial, final]);
    setCapabilities({ ...capabilities, images: "kitty" });
    try {
      for (const mode of ["native", "unwrapped", "wrapped"]) {
        const enhanced = mode !== "native";
        writeTestConfig({ patchCustomTools: mode === "wrapped" });
        let call: Text | undefined;
        let output: Text | undefined;
        const previousCalls: unknown[] = [];
        const previousResults: unknown[] = [];
        const nativeResults: Array<{
          content: unknown;
          image: unknown;
          isPartial: boolean;
        }> = [];
        const { session } = await createSession(
          enhanced,
          undefined,
          undefined,
          [
            ...(enhanced ? [extension] : []),
            (pi) => {
              pi.registerTool({
                name: "image_fixture",
                label: "Image fixture",
                description: "Offline PNG fixture",
                parameters: Type.Object({}),
                execute: async () => final,
                renderCall(_args, _theme, context) {
                  previousCalls.push(context.lastComponent);
                  call ??= new Text("Image fixture", 0, 0);
                  return call;
                },
                renderResult(result, options, _theme, context) {
                  previousResults.push(context.lastComponent);
                  nativeResults.push({
                    content: result.content,
                    image: result.content[1],
                    isPartial: options.isPartial,
                  });
                  output ??= new Text("", 0, 0);
                  output.setText(
                    options.isPartial ? "partial image" : "final image",
                  );
                  return output;
                },
              });
            },
          ],
        );
        const component = toolComponent(session, "image_fixture", {});
        component.setArgsComplete();
        component.markExecutionStarted();
        component.updateResult(partial, true);
        const view = component as unknown as { imageComponents: Image[] };
        const image = view.imageComponents[0]!;
        expect(image).toBeInstanceOf(Image);
        for (const isPartial of [true, false]) {
          component.updateResult(isPartial ? partial : final, isPartial);
          for (const expanded of [false, true, false]) {
            component.setExpanded(expanded);
            component.invalidate();
            const lines = component.render(80);
            expect(view.imageComponents).toHaveLength(1);
            expect(view.imageComponents[0]).toBe(image);
            expect(
              component.children.filter((child) => child === image),
            ).toHaveLength(1);
            const imageLines = image.render(80);
            expect(imageLines.length).toBeGreaterThan(0);
            expect(lines.slice(-imageLines.length)).toEqual(imageLines);
            expect(lines.map(stripAnsi).join("\n")).toContain(
              isPartial ? "partial image" : "final image",
            );
          }
        }
        // Pi catches renderer errors, so assert recorded calls here.
        expect(previousCalls[0]).toBeUndefined();
        expect(previousCalls.length).toBeGreaterThan(1);
        for (const previous of previousCalls.slice(1))
          expect(previous).toBe(call);
        expect(previousResults[0]).toBeUndefined();
        expect(previousResults.length).toBeGreaterThan(1);
        for (const previous of previousResults.slice(1))
          expect(previous).toBe(output);
        for (const result of nativeResults) {
          expect(result.content).toBe(
            result.isPartial ? partial.content : final.content,
          );
          expect(result.image).toBe(png);
        }
        expect([partial, final]).toEqual(snapshots);
      }
    } finally {
      setCapabilities(capabilities);
      writeTestConfig({ patchCustomTools: originalWrapping });
    }
  });

  it("uses Pi's live padding and recorded duration with real tool components", async () => {
    const { session } = await createSession(true);
    for (const [name, args] of [
      ["bash", { command: "echo result" }],
      ["read", { path: "native.txt" }],
      ["codemode", { code: 'text("result")' }],
    ] as const) {
      const component = toolComponent(session, name, args);
      component.setArgsComplete();
      const input = {
        content:
          name === "codemode"
            ? [
                {
                  type: "text" as const,
                  text: "Script completed\nWall time 1.2 seconds\nOutput:\n",
                },
                { type: "text" as const, text: "result" },
              ]
            : [{ type: "text" as const, text: "result" }],
        details: name === "codemode" ? { calls: [] } : {},
        durationMs: 2345,
        isError: false,
      };
      const snapshot = structuredClone(input);
      component.updateResult(input);
      for (const outputPad of [0, 1, 0]) {
        component.setOutputPad(outputPad);
        for (const width of [8, 40, 80]) {
          const rows = component
            .render(width)
            .map(stripAnsi)
            .filter((row) => row.trim());
          expect(rows.every((row) => visibleWidth(row) <= width)).toBe(true);
          expect(
            rows.every((row) => row.startsWith(" ") === (outputPad === 1)),
          ).toBe(true);
          if (name === "bash" && width === 80)
            expect(rows.join("\n")).toContain("took 2.3s");
        }
      }
      expect(input).toEqual(snapshot);
    }
  });

  it("does not mutate Pi's registry method or re-register any tools", async () => {
    const original = ExtensionRunner.prototype.getAllRegisteredTools;
    const { session, resourceLoader } = await createSession(true);
    expect(ExtensionRunner.prototype.getAllRegisteredTools).toBe(original);
    const enhanced = resourceLoader
      .getExtensions()
      .extensions.find(
        (item) => item.tools.size === 0 && item.toolRenderers?.length,
      );
    expect(enhanced).toBeDefined();
    expect(enhanced!.toolRenderers).toHaveLength(1);
    expect(resourceLoader.getExtensions().errors).toEqual([]);
    expect(resourceLoader.getExtensions().warnings ?? []).toEqual([]);
    expect(resolve(session, "read")?.renderCall).not.toBe(
      session.getToolDefinition("read")!.renderCall,
    );
    expect(ExtensionRunner.prototype.getAllRegisteredTools).toBe(original);
  });

  for (const tools of [undefined, ["read"], []]) {
    it(`keeps Pi's native tool inventory and loadout for tools=${JSON.stringify(tools)}`, async () => {
      const baseline = (await createSession(false, tools)).session;
      const enhanced = (await createSession(true, tools)).session;
      expect(enhanced.getAllTools()).toEqual(baseline.getAllTools());
      expect(enhanced.getActiveToolNames()).toEqual(
        baseline.getActiveToolNames(),
      );
      for (const info of enhanced.getAllTools()) {
        const definition = enhanced.getToolDefinition(info.name)!;
        const native = baseline.getToolDefinition(info.name)!;
        expect(definition.parameters).toEqual(native.parameters);
        expect(definition.description).toBe(native.description);
        expect(definition.promptSnippet).toBe(native.promptSnippet);
        expect(definition.promptGuidelines).toEqual(native.promptGuidelines);
        expect(definition.renderShell).toBe(native.renderShell);
      }
    });
  }

  it("executes native Write and Bash in the session directory without modifying their results", async () => {
    const { session } = await createSession(true);
    const context = {
      cwd: directory,
      sessionManager: session.sessionManager,
      model: session.model,
    } as unknown as ExtensionToolContext;
    const write = session.getToolDefinition("write")!;
    await write.execute(
      "write",
      { path: "native.txt", content: "native content" },
      undefined,
      undefined,
      context,
    );
    expect(readFileSync(join(directory, "native.txt"), "utf8")).toBe(
      "native content",
    );
    const result = await session
      .getToolDefinition("bash")!
      .execute("bash", { command: "pwd" }, undefined, undefined, context);
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining(realpathSync(directory)) },
    ]);
    expect(
      (result.details as { durationMs?: number } | undefined)?.durationMs,
    ).toBeUndefined();
    expect(result.structuredContent).toEqual(
      expect.objectContaining({ exit_code: 0 }),
    );
    const edit = session.getToolDefinition("edit")!;
    expect(
      edit.prepareArguments!({
        path: "native.txt",
        edits: { oldText: "before", newText: "after" },
      }),
    ).toEqual({
      path: "native.txt",
      edits: [{ oldText: "before", newText: "after" }],
    });
  });

  it("uses Pi's saved Bash duration on reopening without extra records", async () => {
    const { session } = await createSession(true);
    session.sessionManager.appendMessage({
      role: "user",
      content: "run Bash",
      timestamp: 1,
    });
    session.sessionManager.appendMessage({
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "history-bash",
          name: "bash",
          arguments: { command: "echo timed" },
        },
      ],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "offline",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 1,
    });
    const result = await session
      .getToolDefinition("bash")!
      .execute(
        "history-bash",
        { command: "echo timed" },
        undefined,
        undefined,
        {
          cwd: directory,
          sessionManager: session.sessionManager,
        } as unknown as ExtensionToolContext,
      );
    const snapshot = structuredClone(result);
    session.sessionManager.appendMessage({
      role: "toolResult",
      toolCallId: "history-bash",
      toolName: "bash",
      content: result.content,
      details: result.details as ToolResultMessage["details"],
      durationMs: 1250,
      isError: false,
      timestamp: 2,
    });
    expect(result).toEqual(snapshot);
    const entries = session.sessionManager.getBranch();
    expect(entries.filter((entry) => entry.type === "custom")).toEqual([]);
    const file = session.sessionManager.getSessionFile()!;
    await session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "quit",
    });
    session.dispose();
    sessions.splice(sessions.indexOf(session), 1);
    const reopened = (
      await createSession(true, undefined, SessionManager.open(file))
    ).session;
    const saved = reopened.sessionManager
      .getBranch()
      .find(
        (entry) =>
          entry.type === "message" && entry.message.role === "toolResult",
      );
    expect(saved?.type).toBe("message");
    const message = (saved as { type: "message"; message: ToolResultMessage })
      .message;
    const component = toolComponent(
      reopened,
      "bash",
      { command: "echo timed" },
      "history-bash",
    );
    component.setArgsComplete();
    component.updateResult(message);
    expect(component.render(80).join("\n")).toContain("took 1.3s");
    expect(result).toEqual(snapshot);
  });

  it("uses the resolver chain in HTML exports without changing tool results", async () => {
    const { session } = await createSession(true);
    session.sessionManager.appendMessage({
      role: "user",
      content: "find history",
      timestamp: 1,
    });
    session.sessionManager.appendMessage({
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "find-history",
          name: "find",
          arguments: { pattern: "*.txt", path: "." },
        },
      ],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "offline",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 1,
    });
    session.sessionManager.appendMessage({
      role: "toolResult",
      toolCallId: "find-history",
      toolName: "find",
      content: [{ type: "text", text: "native.txt" }],
      details: undefined,
      isError: false,
      timestamp: 2,
    });
    initTheme("dark", false);
    const data = await exportData(session);
    expect(data.renderedTools["find-history"]?.callHtml).toContain("Find");
    expect(data.renderedTools["find-history"]?.resultHtmlCollapsed).toContain(
      "1 file",
    );
    const renderer = resolve(session, "read")!;
    expect(
      renderer.renderCall!({ path: "native.txt" }, mkTheme(), mkToolCtx())
        .render(80)
        .join("\n"),
    ).toContain("Read");
  });
});
