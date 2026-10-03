import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createCodemodeExtension,
  ExtensionRunner,
  getPackageDir,
  initTheme,
  ToolExecutionComponent,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  KeybindingsManager,
  setKeybindings,
  Text,
  TUI_KEYBINDINGS,
  visibleWidth,
  type TUI,
} from "@earendil-works/pi-tui";
import { registerConfigCommand } from "../../config/command";
import { getSettingItems } from "../../config/settings";
import { getConfig, loadConfig, saveConfig } from "../../config/store";
import { mkTheme, mkToolCtx, setupTool } from "../../testing/helpers";
import { patchBashTool } from "../bash";
import { createCodemodeDefinition } from "../codemode";
import { createWrappedDefinition } from "../custom-tools/definition-adapter";
import { patchCustomToolRendering } from "../custom-tools/patch-manager";
import { patchEditTool } from "../edit";
import { patchFindTool } from "../find";
import { patchGrepTool } from "../grep";
import { patchLsTool } from "../ls";
import { patchReadTool } from "../read";
import { patchWriteTool } from "../write";
import { clearBlinkTimers } from "./state";
import { stripAnsi } from "./text";
import type { BaseRenderState } from "./types";

const originalPath = process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-ui-tool-labels-"));
  process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = join(directory, "settings.json");
  loadConfig();
});
afterEach(() => {
  clearBlinkTimers();
  if (originalPath === undefined)
    delete process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  else process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = originalPath;
  rmSync(directory, { recursive: true, force: true });
  loadConfig();
});

const coreCases: Array<{
  name: string;
  patch: Parameters<typeof setupTool>[0];
  args: Record<string, unknown>;
}> = [
  { name: "read", patch: patchReadTool, args: { path: "CaseFile.txt" } },
  {
    name: "write",
    patch: patchWriteTool,
    args: { path: "CaseFile.txt", content: "contents stay lowercase" },
  },
  {
    name: "edit",
    patch: patchEditTool,
    args: { path: "CaseFile.txt", edits: [{ oldText: "old", newText: "new" }] },
  },
  {
    name: "bash",
    patch: patchBashTool,
    args: { command: 'printf "mixed Case"' },
  },
  { name: "ls", patch: patchLsTool, args: { path: "CaseDirectory" } },
  {
    name: "find",
    patch: patchFindTool,
    args: { pattern: "*.MixedCase", path: "CaseDirectory" },
  },
  {
    name: "grep",
    patch: patchGrepTool,
    args: { pattern: "mixedCase", path: "CaseDirectory" },
  },
];

function nativeCodemode(): ToolDefinition {
  let definition!: ToolDefinition;
  createCodemodeExtension()({
    registerTool(tool: ToolDefinition) {
      definition = tool;
    },
    getSettings: () => ({}),
    getAllTools: () => [],
    appendEntry() {},
  } as unknown as ExtensionAPI);
  return definition;
}
const adapterOptions = { isToolCallActive: () => false, reportIssue: () => {} };
function text(component: { render(width: number): string[] }, width = 160) {
  return stripAnsi(component.render(width).join("\n"));
}
function label(name: string, enabled: boolean) {
  return enabled ? name[0]!.toUpperCase() + name.slice(1) : name;
}

describe("tool-call capitalization", () => {
  for (const testCase of coreCases) {
    it(`applies both values to ${testCase.name} without changing execution or arguments`, () => {
      const definition = setupTool(testCase.patch);
      const execute = definition.execute;
      const parameters = definition.parameters;
      const originalArgs = structuredClone(testCase.args);
      for (const enabled of [true, false]) {
        saveConfig("capitalizeToolNames", String(enabled));
        for (const expanded of [false, true]) {
          const context = mkToolCtx({
            expanded,
            executionStarted: false,
            state: { hasResult: true },
          });
          const component = definition.renderCall!(
            testCase.args,
            mkTheme(),
            context,
          );
          expect(text(component)).toContain(
            ` ${label(testCase.name, enabled)} `,
          );
          expect(definition.name).toBe(testCase.name);
          expect(definition.execute).toBe(execute);
          expect(definition.parameters).toBe(parameters);
          expect(testCase.args).toEqual(originalArgs);
        }
      }
    });

    it(`refreshes a reused ${testCase.name} component without restarting its indicator`, () => {
      const definition = setupTool(testCase.patch);
      const state: BaseRenderState = {};
      const context = mkToolCtx({
        executionStarted: false,
        isPartial: true,
        state,
      });
      const component = definition.renderCall!(
        testCase.args,
        mkTheme(),
        context,
      );
      expect(text(component)).toContain(` ${label(testCase.name, true)} `);
      const blink = state.blinkTimer;
      expect(blink).toBeDefined();
      for (const enabled of [false, true]) {
        saveConfig("capitalizeToolNames", String(enabled));
        component.invalidate();
        expect(text(component)).toContain(` ${label(testCase.name, enabled)} `);
        expect(state.blinkTimer).toBe(blink);
      }
    });
  }

  it("capitalizes core headers even when custom-tool wrapping is disabled", () => {
    saveConfig("patchCustomTools", "false");
    const registryMethod = ExtensionRunner.prototype.getAllRegisteredTools;
    for (const enabled of [false, true]) {
      saveConfig("capitalizeToolNames", String(enabled));
      for (const testCase of coreCases) {
        const component = setupTool(testCase.patch).renderCall!(
          testCase.args,
          mkTheme(),
          mkToolCtx({ executionStarted: false }),
        );
        expect(text(component)).toContain(` ${label(testCase.name, enabled)} `);
      }
    }
    expect(ExtensionRunner.prototype.getAllRegisteredTools).toBe(
      registryMethod,
    );
  });

  it("covers compact Read headers without renaming resource tags or paths", () => {
    const definition = setupTool(patchReadTool);
    for (const enabled of [true, false]) {
      saveConfig("capitalizeToolNames", String(enabled));
      for (const [path, kind, filename] of [
        [
          join(getPackageDir(), "docs", "extensions.md"),
          "docs",
          "extensions.md",
        ],
        [join(directory, "AGENTS.md"), "resource", "AGENTS.md"],
        [join(directory, "mySkill", "SKILL.md"), "skill", "mySkill"],
      ]) {
        const args = { path, offset: 2, limit: 3 };
        const context = mkToolCtx({ cwd: directory, executionStarted: false });
        const collapsed = text(
          definition.renderCall!(args, mkTheme(), context),
          1000,
        );
        expect(collapsed).toContain(
          kind === "skill" ? "[skill]" : `${label("read", enabled)} ${kind}`,
        );
        expect(collapsed).toContain(filename!);
        expect(collapsed).toContain(":2-4");
        const expanded = text(
          definition.renderCall!(args, mkTheme(), {
            ...context,
            expanded: true,
          }),
          1000,
        );
        expect(expanded).toContain(` ${label("read", enabled)} `);
        expect(expanded).toContain(kind === "skill" ? "SKILL.md" : filename!);
      }
    }
  });

  it("refreshes Codemode without restarting its blink or changing native details", () => {
    const native = nativeCodemode();
    const wrapped = createCodemodeDefinition(native, adapterOptions);
    const state: BaseRenderState = {};
    const context = mkToolCtx({
      executionStarted: false,
      isPartial: true,
      state: { _uiEnhancements: state },
    });
    const args = { code: 'text("keep mixed Case");\ntext("last");' };
    const component = wrapped.renderCall!(args, mkTheme(), context);
    expect(text(component)).toContain("Codemode");
    const blink = state.blinkTimer;
    expect(blink).toBeDefined();
    for (const enabled of [false, true]) {
      saveConfig("capitalizeToolNames", String(enabled));
      component.invalidate();
      expect(text(component)).toContain(` ${label("codemode", enabled)} `);
      expect(state.blinkTimer).toBe(blink);
    }
    for (const enabled of [false, true]) {
      saveConfig("capitalizeToolNames", String(enabled));
      const context = mkToolCtx({ executionStarted: false });
      expect(
        text(
          wrapped.renderCall!(args, mkTheme(), { ...context, expanded: true }),
        ),
      ).toContain(` ${label("codemode", enabled)}`);
      const result = {
        content: [{ type: "text" as const, text: "output remains lowercase" }],
        details: {
          calls: [
            {
              id: "nested",
              name: "read",
              args: '{"path":"CaseFile.txt"}',
              status: "ok",
            },
          ],
        },
      };
      const snapshot = structuredClone(result);
      const output = text(
        wrapped.renderResult!(
          result,
          { expanded: true, isPartial: false },
          mkTheme(),
          context,
        ),
      );
      expect(output).toContain("read");
      expect(output).toContain("output remains lowercase");
      expect(result).toEqual(snapshot);
      expect(wrapped.execute).toBe(native.execute);
    }
  });

  it("uses the same rule for third-party native headers and both fallback paths", () => {
    const native = nativeCodemode();
    const renderers: Array<ToolDefinition["renderCall"]> = [
      undefined,
      () =>
        new Text(
          '\x1b[35msearchAPI\x1b[0m query="mixed Case"\n\n  detail staysLower',
          0,
          0,
        ),
      () => {
        throw new Error("factory failed");
      },
      () => ({
        render() {
          throw new Error("layout failed");
        },
        invalidate() {},
      }),
    ];
    for (const renderCall of renderers) {
      const definition = {
        ...native,
        name: "searchAPI",
        label: "searchAPI",
        renderCall,
      };
      const wrapped = createWrappedDefinition(definition, adapterOptions);
      const args = { query: "mixed Case" };
      for (const expanded of [false, true]) {
        const component = wrapped.renderCall!(
          args,
          mkTheme(),
          mkToolCtx({ expanded, executionStarted: false }),
        );
        for (const enabled of [true, false, true]) {
          saveConfig("capitalizeToolNames", String(enabled));
          component.invalidate();
          const output = text(component);
          expect(output).toContain(label("searchAPI", enabled));
          expect(output).toContain("mixed Case");
          if (renderCall === renderers[1] && expanded)
            expect(output).toContain("  detail staysLower");
          expect(wrapped.name).toBe("searchAPI");
          expect(wrapped.execute).toBe(definition.execute);
        }
      }
    }
    const proper = createWrappedDefinition<ToolDefinition>(
      { ...native, label: "Web Search", renderCall: undefined },
      adapterOptions,
    );
    saveConfig("capitalizeToolNames", "false");
    expect(text(proper.renderCall!({}, mkTheme(), mkToolCtx()))).toContain(
      "Web Search",
    );
  });

  it("leaves self-rendering third-party labels untouched with either setting", () => {
    const prototype = ExtensionRunner.prototype;
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      prototype,
      "getAllRegisteredTools",
    )!;
    const native = {
      ...nativeCodemode(),
      name: "searchAPI",
      label: "searchAPI",
      renderShell: "self" as const,
      renderCall: () => new Text("searchAPI", 0, 0),
    };
    Object.defineProperty(prototype, "getAllRegisteredTools", {
      ...originalDescriptor,
      value: () => [{ definition: native }],
    });
    const handle = patchCustomToolRendering();
    try {
      for (const enabled of [true, false]) {
        saveConfig("capitalizeToolNames", String(enabled));
        const registered = prototype.getAllRegisteredTools()[0]!.definition;
        expect(registered).toBe(native);
        expect(
          text(registered.renderCall!({}, mkTheme(), mkToolCtx())).trimEnd(),
        ).toBe("searchAPI");
      }
    } finally {
      handle.dispose();
      Object.defineProperty(
        prototype,
        "getAllRegisteredTools",
        originalDescriptor,
      );
    }
  });

  it("fits resized core, Codemode and third-party headers with both settings", () => {
    const native = nativeCodemode();
    const cases: Array<{
      definition: ToolDefinition;
      args: Record<string, unknown>;
    }> = coreCases.map((testCase) => ({
      definition: setupTool(testCase.patch),
      args: {
        ...testCase.args,
        path: "界".repeat(70) + "/CaseFile.txt",
        command: "echo " + "x".repeat(300),
      },
    }));
    cases.push({
      definition: createCodemodeDefinition(native, adapterOptions),
      args: { code: 'text("' + "x".repeat(300) + '");\ntext("last");' },
    });
    cases.push({
      definition: createWrappedDefinition(
        {
          ...native,
          label: "searchAPI",
          renderCall: () => new Text("searchAPI " + "界".repeat(70), 0, 0),
        },
        adapterOptions,
      ),
      args: {},
    });
    for (const { definition, args } of cases) {
      for (const expanded of [false, true]) {
        const component = definition.renderCall!(
          args,
          mkTheme(),
          mkToolCtx({ expanded, executionStarted: false }),
        );
        for (const enabled of [true, false]) {
          saveConfig("capitalizeToolNames", String(enabled));
          component.invalidate();
          for (const width of [1, 2, 3, 5, 10, 20, 40, 80, 120, 200, 40]) {
            expect(
              component
                .render(width)
                .every((row) => visibleWidth(row) <= width),
            ).toBe(true);
          }
        }
      }
    }
  });

  it("redraws existing Pi tool components when the settings menu toggles capitalization", async () => {
    initTheme("dark", false);
    saveConfig("showExpansionHint", "false");
    const previousKeys = getKeybindings();
    setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
    try {
      const notifications: string[] = [];
      const native = nativeCodemode();
      const definitions = [
        {
          definition: setupTool(patchReadTool),
          args: { path: "CaseFile.txt" },
          name: "read",
        },
        {
          definition: createCodemodeDefinition(native, adapterOptions),
          args: { code: 'text("case Sensitive");' },
          name: "codemode",
        },
        {
          definition: createWrappedDefinition(
            {
              ...native,
              name: "searchAPI",
              label: "searchAPI",
              renderCall: () => new Text("searchAPI case Sensitive", 0, 0),
            },
            adapterOptions,
          ),
          args: {},
          name: "searchAPI",
        },
      ];
      const ui = { requestRender() {} } as unknown as TUI;
      const components = definitions.map(
        ({ definition, args }) =>
          new ToolExecutionComponent(
            definition.name,
            "label-toggle",
            args,
            { showImages: false },
            definition,
            ui,
            directory,
          ),
      );
      let command!: Parameters<ExtensionAPI["registerCommand"]>[1];
      registerConfigCommand(
        {
          registerCommand(_name, definition) {
            command = definition;
          },
        } as ExtensionAPI,
        () => {},
        () => {},
      );
      const index = getSettingItems(getConfig()).findIndex(
        (item) => item.id === "capitalizeToolNames",
      );
      for (const enabled of [false, true]) {
        await command.handler("", {
          mode: "tui",
          ui: {
            notify(message: string) {
              notifications.push(message);
            },
            custom: async (factory: Function) => {
              const settings = factory(
                {
                  invalidate: () =>
                    components.forEach((component) => component.invalidate()),
                  requestRender() {},
                  terminal: { rows: 24 },
                },
                mkTheme(),
                previousKeys,
                () => {},
              );
              for (let row = 0; row < index; row++)
                settings.handleInput("\x1b[B");
              settings.handleInput("\r");
            },
          },
        } as never);
        expect(notifications).toEqual([]);
        expect(getConfig().capitalizeToolNames).toBe(enabled);
        for (let i = 0; i < components.length; i++)
          expect(text(components[i]!)).toContain(
            label(definitions[i]!.name, enabled),
          );
      }
    } finally {
      setKeybindings(previousKeys);
    }
  });
});
