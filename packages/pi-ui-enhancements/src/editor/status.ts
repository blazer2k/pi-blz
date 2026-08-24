import type { Config } from "../config";
import { shortenPath } from "../path-utils";
import type { EditorFrameData } from "./frame";
import { formatTokens, type SessionUsage } from "./usage";

type EditorStatusConfig = Pick<
  Config,
  | "roundedEditorShowBranch"
  | "roundedEditorShowCacheTokens"
  | "roundedEditorShowCost"
  | "roundedEditorShowThinkingLevel"
>;

export type EditorStatusInput = {
  cwd: string;
  modelId?: string;
  modelContextWindow?: number;
  modelSupportsReasoning: boolean;
  activeThinkingLevel: string | null;
  activeThinkingLevelSupported: boolean;
  contextPercent: number | null;
  gitBranch: string | null;
  usage: SessionUsage;
};

function getVisibleThinkingLevel(
  input: EditorStatusInput,
  config: EditorStatusConfig,
): string | null {
  const level = input.activeThinkingLevel;
  if (
    !config.roundedEditorShowThinkingLevel ||
    !input.modelSupportsReasoning ||
    !level ||
    level === "off" ||
    !input.activeThinkingLevelSupported
  ) {
    return null;
  }
  return level;
}

export function buildEditorFrameData(
  input: EditorStatusInput,
  config: EditorStatusConfig,
): EditorFrameData {
  const contextWindow = input.modelContextWindow
    ? formatTokens(input.modelContextWindow)
    : "?";
  const pct =
    input.contextPercent === null
      ? `?%/${contextWindow}`
      : `${input.contextPercent.toFixed(1)}%/${contextWindow}`;
  const branch = config.roundedEditorShowBranch ? input.gitBranch : null;
  const cwd = branch
    ? `${shortenPath(input.cwd)} (${branch})`
    : shortenPath(input.cwd);

  return {
    cwd,
    modelId: input.modelId ?? "?",
    thinkingLevel: getVisibleThinkingLevel(input, config),
    pct,
    pctValue: input.contextPercent,
    ...input.usage,
    showCacheTokens: config.roundedEditorShowCacheTokens,
    showCost: config.roundedEditorShowCost,
  };
}
