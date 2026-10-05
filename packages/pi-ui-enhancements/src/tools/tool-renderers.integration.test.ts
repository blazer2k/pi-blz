import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  initTheme,
  DefaultResourceLoader,
  ExtensionRunner,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import extension from "../index";
import { loadConfig } from "../config/store";
import { mkTheme, mkToolCtx } from "../testing/helpers";

const originalPath = process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
let directory: string;
const sessions: AgentSession[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-ui-renderer-ownership-"));
  process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = join(directory, "ui.json");
  loadConfig();
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
) {
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
        }),
      },
      ...(enhanced ? [extension] : []),
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
  await session.bindExtensions({ mode: "json" });
  return { session, resourceLoader };
}

function resolve(session: AgentSession, name: string) {
  return session.extensionRunner.resolveToolRenderers(name, () =>
    session.getToolDefinition(name),
  );
}

describe("public renderer integration", () => {
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

  it("preserves Bash durations on reopening without changing results or model context", async () => {
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
    await session.extensionRunner.emit({
      type: "tool_execution_start",
      toolCallId: "history-bash",
      toolName: "bash",
      args: { command: "echo timed" },
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
    await session.extensionRunner.emit({
      type: "tool_execution_end",
      toolCallId: "history-bash",
      toolName: "bash",
      result,
      isError: false,
    });
    session.sessionManager.appendMessage({
      role: "toolResult",
      toolCallId: "history-bash",
      toolName: "bash",
      content: result.content,
      details: result.details as ToolResultMessage["details"],
      isError: false,
      timestamp: 2,
    });
    expect(result).toEqual(snapshot);
    const entries = session.sessionManager.getBranch();
    expect(
      entries.some(
        (entry) =>
          entry.type === "custom" &&
          entry.customType === "pi-ui-enhancements:bash-timing",
      ),
    ).toBe(true);
    expect(
      JSON.stringify(session.sessionManager.buildSessionContext().messages),
    ).not.toContain("pi-ui-enhancements:bash-timing");
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
    const context = mkToolCtx({
      toolCallId: "history-bash",
      executionStarted: false,
    });
    const output = resolve(reopened, "bash")!.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mkTheme(),
      context,
    )
      .render(80)
      .join("\n");
    expect(output).toContain("took ");
    expect((context.state as { startedAt?: number }).startedAt).toBeUndefined();
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
    const html = readFileSync(
      await session.exportToHtml(join(directory, "export.html")),
      "utf8",
    );
    const encoded =
      /<script id="session-data" type="application\/json">([^<]*)<\/script>/.exec(
        html,
      )?.[1];
    expect(encoded).toBeDefined();
    const data = JSON.parse(Buffer.from(encoded!, "base64").toString("utf8"));
    expect(data.renderedTools["find-history"].callHtml).toContain("Find");
    expect(data.renderedTools["find-history"].resultHtmlCollapsed).toContain(
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
