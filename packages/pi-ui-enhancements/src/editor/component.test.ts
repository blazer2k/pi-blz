import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import type { Config } from "../config/definition";
import {
  getConfig,
  loadConfig,
  saveConfig,
  type ConfigStorage,
} from "../config/store";
import { mkTheme } from "../testing/helpers";
import { RoundedEditor } from "./component";

const memoryStorage: ConfigStorage = {
  prepare() {},
  exists: () => true,
  read: () => "{}",
  write() {},
};

let previousConfig: Config;

beforeEach(() => {
  previousConfig = getConfig();
  loadConfig(undefined, memoryStorage);
});

afterEach(() => {
  loadConfig(undefined, {
    ...memoryStorage,
    read: () => JSON.stringify(previousConfig),
  });
});

function createEditor(command = "hello") {
  let dimFrameCalls = 0;
  let thinkingBorderCalls = 0;
  let bashBorderCalls = 0;
  const uiTheme = {
    ...mkTheme(),
    fg: (color: string, text: string) => {
      if (color === "dim") dimFrameCalls++;
      return text;
    },
    getThinkingBorderColor: () => {
      thinkingBorderCalls++;
      return (text: string) => text;
    },
    getBashModeBorderColor: () => {
      bashBorderCalls++;
      return (text: string) => text;
    },
  };
  const context = {
    cwd: "/repo",
    model: {
      id: "test-model",
      contextWindow: 100_000,
      reasoning: true,
      thinkingLevelMap: { high: "high" },
    },
    getContextUsage: () => ({ percent: 75 }),
    ui: { theme: uiTheme },
  } as unknown as ExtensionContext;
  const pi = {
    getThinkingLevel: () => "high",
  } as unknown as ExtensionAPI;
  const tui = {
    terminal: { rows: 24 },
    requestRender: () => {},
  } as unknown as TUI;
  const editorTheme = {
    borderColor: (text: string) => text,
    selectList: {},
  } as unknown as EditorTheme;
  const keybindings = { matches: () => false } as unknown as KeybindingsManager;
  const editor = new RoundedEditor(
    tui,
    editorTheme,
    keybindings,
    context,
    pi,
    () => "main",
    () => ({
      inputTokens: 1_500,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0,
    }),
  );
  editor.setText(command);

  return {
    editor,
    getDimFrameCalls: () => dimFrameCalls,
    getThinkingBorderCalls: () => thinkingBorderCalls,
    getBashBorderCalls: () => bashBorderCalls,
  };
}

describe("RoundedEditor", () => {
  it("assembles status content with the default dim frame", () => {
    const { editor, getDimFrameCalls, getThinkingBorderCalls } = createEditor();
    const output = editor.render(80).join("\n");

    expect(output).toContain("/repo (main)");
    expect(output).toContain("test-model (high)");
    expect(output).toContain("↑1.5k ↓500 75.0%/100k");
    expect(getDimFrameCalls()).toBeGreaterThan(0);
    expect(getThinkingBorderCalls()).toBe(0);
  });

  it("uses the thinking frame color when configured", () => {
    saveConfig("roundedEditorColor", "thinking", memoryStorage);
    const { editor, getThinkingBorderCalls } = createEditor();

    editor.render(80);

    expect(getThinkingBorderCalls()).toBe(1);
  });

  it("uses the Bash border for shell input", () => {
    const { editor, getBashBorderCalls, getThinkingBorderCalls } =
      createEditor("!pwd");

    editor.render(80);

    expect(getBashBorderCalls()).toBe(1);
    expect(getThinkingBorderCalls()).toBe(0);
  });
});
