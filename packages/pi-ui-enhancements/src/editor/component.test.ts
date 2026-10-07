import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  visibleWidth,
  type AutocompleteProvider,
} from "@earendil-works/pi-tui";
import { stripAnsi } from "../tools/rendering/text";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import type { Config } from "../config/definition";
import { getConfig, loadConfig, type ConfigStorage } from "../config/store";
import { mkTheme, setTestConfig } from "../testing/helpers";
import { EnhancedEditor } from "./component";

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

function createEditor(
  command = "hello",
  style: "compact" | "rounded" = "rounded",
) {
  let dimFrameCalls = 0;
  const frameColors: string[] = [];
  let thinkingBorderCalls = 0;
  let bashBorderCalls = 0;
  const uiTheme = {
    ...mkTheme(),
    fg: (color: string, text: string) => {
      frameColors.push(color);
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
    selectList: {
      selectedPrefix: (text: string) => text,
      selectedText: (text: string) => text,
      description: (text: string) => text,
      scrollInfo: (text: string) => text,
      noMatch: (text: string) => text,
    },
  } as unknown as EditorTheme;
  const keybindings = { matches: () => false } as unknown as KeybindingsManager;
  const editor = new EnhancedEditor(
    tui,
    editorTheme,
    keybindings,
    context,
    pi,
    () => "main",
    () => ({
      inputTokens: 1_500,
      outputTokens: 500,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 3_000,
      totalCost: 0.25,
    }),
    style,
  );
  editor.setText(command);

  return {
    editor,
    native: new CustomEditor(tui, editorTheme, keybindings, { paddingX: 1 }),
    getFrameColors: () => frameColors,
    getDimFrameCalls: () => dimFrameCalls,
    getThinkingBorderCalls: () => thinkingBorderCalls,
    getBashBorderCalls: () => bashBorderCalls,
  };
}

describe("EnhancedEditor", () => {
  it("assembles status content with the default dim frame and cost", () => {
    const { editor, getDimFrameCalls, getThinkingBorderCalls } = createEditor();
    const output = editor.render(80).join("\n");

    expect(output).toContain("/repo (main)");
    expect(output).toContain("test-model (high)");
    expect(output).toContain("↑1.5k ↓500 $0.25 75.0%/100k");
    expect(getDimFrameCalls()).toBeGreaterThan(0);
    expect(getThinkingBorderCalls()).toBe(0);
  });

  it("uses each configured color in either custom style", () => {
    for (const style of ["compact", "rounded"] as const) {
      for (const editorColor of ["thinking", "dim", "muted"] as const) {
        setTestConfig({ editorColor });
        const { editor, getThinkingBorderCalls, getFrameColors } = createEditor(
          "hello",
          style,
        );
        editor.render(80);
        expect(getThinkingBorderCalls() > 0).toBe(editorColor === "thinking");
        if (editorColor !== "thinking")
          expect(getFrameColors()).toContain(editorColor);
      }
    }
  });

  it("applies every metadata toggle to both custom styles", () => {
    for (const style of ["compact", "rounded"] as const) {
      const { editor } = createEditor("hello", style);
      setTestConfig({
        editorShowThinkingLevel: false,
        editorShowBranch: false,
        editorShowCacheTokens: false,
        editorShowCost: false,
      });
      const hidden = editor.render(120).join("\n");
      expect(hidden).not.toContain("(high)");
      expect(hidden).not.toContain("(main)");
      expect(hidden).not.toContain("R2.0k");
      expect(hidden).not.toContain("W3.0k");
      expect(hidden).not.toContain("$0.25");
      setTestConfig({
        editorShowThinkingLevel: true,
        editorShowBranch: true,
        editorShowCacheTokens: true,
        editorShowCost: true,
      });
      const shown = editor.render(120).join("\n");
      expect(shown).toContain("(high)");
      expect(shown).toContain("(main)");
      expect(shown).toContain("R2.0k W3.0k $0.25");
    }
  });

  it("uses the Bash border for shell input in either custom style", () => {
    for (const style of ["compact", "rounded"] as const) {
      const { editor, getBashBorderCalls, getThinkingBorderCalls } =
        createEditor("!pwd", style);
      editor.render(80);
      expect(getBashBorderCalls()).toBeGreaterThan(0);
      expect(getThinkingBorderCalls()).toBe(0);
    }
  });

  it("keeps compact input, padding, cursor, wrapping, and scrolling identical to native", () => {
    const text = Array.from(
      { length: 20 },
      (_, i) => `${i}: 界 wide input and words`,
    ).join("\n");
    const { editor, native } = createEditor(text, "compact");
    native.setText(text);
    editor.focused = native.focused = true;
    for (const width of [12, 40, 80]) {
      for (let i = 0; i < 8; i++) {
        editor.handleInput("\x1b[A");
        native.handleInput("\x1b[A");
      }
      const expected = native.render(width);
      const actual = editor.render(width);
      expect(actual.slice(1, -1)).toEqual(expected.slice(1, -1));
      expect(actual.join("\n")).toContain(CURSOR_MARKER);
      expect(actual.join("\n")).not.toMatch(/[╭╮╰╯│▲▼]/u);
      for (const index of [0, expected.length - 1]) {
        const notice = stripAnsi(expected[index]!).match(/[↑↓] \d+ more/);
        if (notice && width >= 40)
          expect(stripAnsi(actual[index]!)).toContain(notice[0]);
      }
      expect(editor.getText()).toBe(native.getText());
    }
  });

  it("keeps compact autocomplete below the lower rule and preserves native completion", async () => {
    const { editor, native } = createEditor("/h", "compact");
    native.setText("/h");
    const provider: AutocompleteProvider = {
      async getSuggestions() {
        return { prefix: "/h", items: [{ value: "/hello", label: "/hello" }] };
      },
      applyCompletion() {
        return { lines: ["/hello"], cursorLine: 0, cursorCol: 6 };
      },
    };
    for (const instance of [editor, native]) {
      instance.setAutocompleteProvider(provider);
      instance.focused = true;
      instance.handleInput("\t");
    }
    await Bun.sleep(0);
    expect(editor.isShowingAutocomplete()).toBe(true);
    expect(editor.render(80).slice(1, 2)).toEqual(
      native.render(80).slice(1, 2),
    );
    expect(editor.render(80).slice(3)).toEqual(native.render(80).slice(3));
    expect(stripAnsi(editor.render(80)[2]!)).toContain("test-model");
    editor.handleInput("\t");
    native.handleInput("\t");
    expect(editor.getText()).toBe("/hello");
    expect(editor.getText()).toBe(native.getText());
    expect(editor.isShowingAutocomplete()).toBe(false);
  });

  it("fits both custom styles at widths zero through 200", () => {
    for (const style of ["compact", "rounded"] as const) {
      const { editor } = createEditor("long input".repeat(20), style);
      for (let width = 0; width <= 200; width++) {
        for (const line of editor.render(width))
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
