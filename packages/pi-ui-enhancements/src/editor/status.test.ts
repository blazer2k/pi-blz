import { describe, expect, it } from "bun:test";
import { getDefaultConfig } from "../config/definition";
import { buildEditorFrameData, type EditorStatusInput } from "./status";

const input: EditorStatusInput = {
  cwd: "/repo",
  modelId: "test-model",
  modelContextWindow: 100_000,
  modelSupportsReasoning: true,
  activeThinkingLevel: "high",
  activeThinkingLevelSupported: true,
  contextPercent: 75,
  gitBranch: "main",
  usage: {
    inputTokens: 1_500,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 100,
    totalCost: 0.25,
  },
};

describe("buildEditorFrameData", () => {
  it("builds the complete editor status view", () => {
    expect(buildEditorFrameData(input, getDefaultConfig())).toEqual({
      cwd: "/repo (main)",
      modelId: "test-model",
      thinkingLevel: "high",
      pct: "75.0%/100k",
      pctValue: 75,
      inputTokens: 1_500,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
      totalCost: 0.25,
      showCacheTokens: false,
      showCost: false,
    });
  });

  it("hides unsupported thinking and optional branch data", () => {
    const config = {
      ...getDefaultConfig(),
      roundedEditorShowBranch: false,
    };
    const data = buildEditorFrameData(
      {
        ...input,
        activeThinkingLevelSupported: false,
        contextPercent: null,
        modelContextWindow: undefined,
      },
      config,
    );

    expect(data.cwd).toBe("/repo");
    expect(data.thinkingLevel).toBeNull();
    expect(data.pct).toBe("?%/?");
  });
});
