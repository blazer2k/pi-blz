import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createAgentSession,
  createCodemodeExtension,
  createReadTool,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import extension from "../index";
import { loadConfig, saveConfig } from "../config/store";
import { cleanRunnerProto, mkTheme, mkToolCtx } from "../testing/helpers";
import { createCodemodeDefinition } from "./codemode";
import { shouldWrapDefinition } from "./custom-tools/definition-adapter";

const originalPath = process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
let directory: string;
beforeEach(() => {
  cleanRunnerProto();
  directory = mkdtempSync(join(tmpdir(), "pi-ui-codemode-wrapper-"));
  process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = join(
    directory,
    "ui-settings.json",
  );
  loadConfig();
});
afterEach(() => {
  cleanRunnerProto();
  rmSync(directory, { recursive: true, force: true });
  if (originalPath === undefined)
    delete process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  else process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = originalPath;
  loadConfig();
});

function nativeDefinition() {
  let native!: ToolDefinition;
  createCodemodeExtension()({
    registerTool(tool: ToolDefinition) {
      native = tool;
    },
    getSettings: () => ({}),
    getAllTools: () => [],
    appendEntry() {},
  } as unknown as ExtensionAPI);
  return native;
}

describe("Codemode wrapper integration", () => {
  it("changes only renderer ownership while preserving native properties by reference", () => {
    const native = nativeDefinition();
    const wrapped = createCodemodeDefinition(native, {
      isToolCallActive: () => false,
      reportIssue: () => {},
    });
    for (const key of Object.keys(native) as Array<keyof ToolDefinition>) {
      if (["renderShell", "renderCall", "renderResult"].includes(key)) continue;
      expect(wrapped[key]).toBe(native[key]);
    }
    expect(wrapped.renderShell).toBe("self");
    expect(wrapped.renderCall).not.toBe(native.renderCall);
    expect(wrapped.renderResult).not.toBe(native.renderResult);
    expect(shouldWrapDefinition(wrapped)).toBe(false);
    const read = createReadTool(directory);
    const loadout = {
      declared: [read],
      callable: [read],
      registered: [read],
      getExposure: () => "direct" as const,
      getNamespace: () => undefined,
    };
    expect(wrapped.prepareLoadout!(loadout)).toEqual(
      native.prepareLoadout!(loadout),
    );
  });

  it("retains Pi's built-in extension without duplicate registration or startup warnings", async () => {
    const settings = SettingsManager.inMemory({
      defaultTools: ["read", "bash", "edit", "write"],
    });
    const loader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager: settings,
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
        extension,
      ],
    });
    await loader.reload();
    const modelRuntime = await ModelRuntime.create({
      authPath: join(directory, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(directory, "models.json"),
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    for (const { tools, excludeTools, defaultTools, available, active } of [
      {
        tools: undefined,
        excludeTools: undefined,
        defaultTools: ["read"],
        available: true,
        active: false,
      },
      {
        tools: ["codemode"],
        excludeTools: undefined,
        defaultTools: ["read"],
        available: true,
        active: true,
      },
      {
        tools: [],
        excludeTools: undefined,
        defaultTools: ["read"],
        available: false,
        active: false,
      },
      {
        tools: undefined,
        excludeTools: undefined,
        defaultTools: ["codemode"],
        available: true,
        active: true,
      },
      {
        tools: ["codemode"],
        excludeTools: ["codemode"],
        defaultTools: ["codemode"],
        available: false,
        active: false,
      },
    ]) {
      settings.applyOverrides({ defaultTools });
      saveConfig("patchCustomTools", "false");
      const { session } = await createAgentSession({
        cwd: directory,
        agentDir: directory,
        resourceLoader: loader,
        settingsManager: settings,
        modelRuntime,
        tools,
        excludeTools,
        sessionManager: SessionManager.inMemory(directory),
      });
      try {
        await session.bindExtensions({ mode: "json" });
        const nativeExtension = loader
          .getExtensions()
          .extensions.find((entry) => entry.path === "builtin:codemode")!;
        expect(nativeExtension).toBeDefined();
        expect(loader.getExtensions().errors).toEqual([]);
        expect(loader.getExtensions().warnings ?? []).toEqual([]);
        expect(
          loader
            .getExtensions()
            .extensions.filter((entry) => entry.tools.has("codemode")),
        ).toHaveLength(1);
        expect(
          session.getAllTools().filter((tool) => tool.name === "codemode"),
        ).toHaveLength(available ? 1 : 0);
        expect(session.getActiveToolNames().includes("codemode")).toBe(active);
        const native = nativeExtension.tools.get("codemode")!.definition;
        const getRegistered = () =>
          session.extensionRunner
            .getAllRegisteredTools()
            .find((tool) => tool.definition.name === "codemode")!;
        expect(getRegistered().definition).toBe(native);
        for (const enabled of [true, false, true]) {
          saveConfig("patchCustomTools", String(enabled));
          const registered = getRegistered();
          expect(registered.sourceInfo.path).toBe("builtin:codemode");
          expect(registered.definition.execute).toBe(native.execute);
          expect(registered.definition.parameters).toBe(native.parameters);
          expect(registered.definition.prepareLoadout).toBe(
            native.prepareLoadout,
          );
          if (enabled) {
            expect(registered.definition).not.toBe(native);
            expect(getRegistered().definition).toBe(registered.definition);
            expect(
              registered.definition.renderResult!(
                {
                  content: [{ type: "text", text: "a\nb\nc\nd" }],
                  details: { calls: [] },
                },
                { expanded: false, isPartial: false },
                mkTheme(),
                mkToolCtx(),
              )
                .render(120)
                .join("\n"),
            ).toContain("+2 lines");
          } else expect(registered.definition).toBe(native);
          expect(session.getActiveToolNames().includes("codemode")).toBe(
            active,
          );
        }
        session.setActiveToolsByName(["codemode", "read"]);
        expect(session.getActiveToolNames().includes("codemode")).toBe(
          available,
        );
        await session.reload();
        expect(
          loader
            .getExtensions()
            .extensions.find((entry) => entry.path === "builtin:codemode"),
        ).toBeDefined();
        expect(loader.getExtensions().warnings ?? []).toEqual([]);
        expect(session.getActiveToolNames().includes("codemode")).toBe(
          available,
        );
        session.setActiveToolsByName([]);
        expect(session.getActiveToolNames()).toEqual([]);
      } finally {
        await session.extensionRunner.emit({
          type: "session_shutdown",
          reason: "quit",
        });
        session.dispose();
      }
    }
  });
});
