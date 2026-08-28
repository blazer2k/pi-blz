import { highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type Text,
} from "@earendil-works/pi-tui";
import { getBlinkIndicator, getMaxCallWidth } from "../rendering/state";
import { sanitizeMultilineDisplayText } from "../rendering/text";
import { getCallRenderParts } from "../rendering/tree";
import type { BashRenderState, BashToolInput } from "./types";

type BashCallContext = {
  state: unknown;
  executionStarted?: boolean;
  isPartial?: boolean;
  expanded: boolean;
  invalidate: () => void;
};

function getHighlightedCommands(
  state: BashRenderState,
  source: string,
  collapsedSource: string,
): NonNullable<BashRenderState["callHighlightCache"]> {
  if (state.hasResult !== true && state.callHighlightCache?.source === source) {
    return state.callHighlightCache;
  }

  state.callHighlightCache = {
    source,
    expandedCommand: highlightCode(source, "bash").join("\n"),
    collapsedCommand: highlightCode(collapsedSource, "bash").join("\n"),
  };
  return state.callHighlightCache;
}

export function renderBashCall(
  args: BashToolInput,
  theme: Theme,
  toolContext: BashCallContext,
): Text {
  const state = toolContext.state as BashRenderState;

  if (toolContext.executionStarted && state.startedAt === undefined) {
    state.startedAt = Date.now();
    state.endedAt = undefined;
  }

  const command =
    typeof args.command === "string"
      ? sanitizeMultilineDisplayText(args.command)
      : "...";
  const collapsedSource = command.replace(/\s+/g, " ").trim();
  const { expandedCommand, collapsedCommand: highlightedCollapsedCommand } =
    getHighlightedCommands(state, command, collapsedSource);
  const timeoutText = args.timeout ? `(timeout ${args.timeout}s)` : "";
  const inlineTimeoutSuffix = timeoutText
    ? theme.fg("dim", ` ${timeoutText}`)
    : "";
  const staticWidth =
    visibleWidth(`${getBlinkIndicator().filled} `) +
    visibleWidth("Bash ") +
    visibleWidth("$ ") +
    visibleWidth(inlineTimeoutSuffix);
  const commandBudget = Math.max(1, getMaxCallWidth() - staticWidth);
  const commandTruncated = visibleWidth(collapsedSource) > commandBudget;
  state.callExpandable = commandTruncated || command.includes("\n");
  const expanded =
    toolContext.expanded &&
    (state.callExpandable || state.resultExpandable === true);
  const { text, prefix } = getCallRenderParts(state, theme, toolContext, {
    staticActive: expanded,
  });

  const visibleCommand = expanded
    ? expandedCommand
    : truncateToWidth(
        highlightedCollapsedCommand,
        commandBudget,
        theme.fg("dim", "..."),
      );
  const commandDisplay = theme.fg("dim", "$ ") + visibleCommand;
  const finalCommandLine = visibleCommand.split("\n").at(-1) ?? "";
  const expandedCommandBudget =
    commandBudget + visibleWidth(inlineTimeoutSuffix);
  const timeoutOnOwnLine =
    expanded &&
    timeoutText.length > 0 &&
    visibleWidth(finalCommandLine + ` ${timeoutText}`) > expandedCommandBudget;

  const timeoutDisplay = timeoutOnOwnLine
    ? `\n${theme.fg("dim", timeoutText)}`
    : inlineTimeoutSuffix;
  const title = theme.fg("toolTitle", theme.bold("Bash "));
  text.setText(prefix + title + commandDisplay + timeoutDisplay);
  return text;
}
