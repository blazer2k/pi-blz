import { describe, expect, it } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { mkTheme } from "../testing/helpers";
import { RoundedEditor } from "./component";

function createEditor(command = "hello") {
  let thinkingBorderCalls = 0;
  let bashBorderCalls = 0;
  const uiTheme = {
    ...mkTheme(),
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
    getThinkingBorderCalls: () => thinkingBorderCalls,
    getBashBorderCalls: () => bashBorderCalls,
  };
}

describe("RoundedEditor", () => {
  it("assembles model, usage, context, branch, and thinking status", () => {
    const { editor, getThinkingBorderCalls } = createEditor();
    const output = editor.render(80).join("\n");

    expect(output).toContain("/repo (main)");
    expect(output).toContain("test-model (high)");
    expect(output).toContain("↑1.5k ↓500 75.0%/100k");
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
