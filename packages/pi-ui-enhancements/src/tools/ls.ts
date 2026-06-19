import type {
  ExtensionAPI,
  ExtensionContext,
  ToolRenderResultOptions,
  LsToolDetails,
  Theme,
  LsToolInput,
} from "@earendil-works/pi-coding-agent";
import { createLsTool } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
import { TOOL_PROMPTS } from "./tool-prompts";
import { registerPatchedTool } from "./tool-registration";
import {
  type BaseRenderState,
  MAX_CALL_WIDTH,
  buildHint,
  extractTextContent,
  formatSimpleErrorResult,
  formatTreeLine,
  getCallRenderParts,
  getResultSymbolColor,
  getResultText,
  invalidateIfChanged,
  normalizeOutput,
  renderPath,
  updateResultState,
} from "./tool-rendering";

const MAX_EXPANDED_ENTRIES = 20;

function isDirectoryEntry(line: string): boolean {
  return line.endsWith("/");
}

function formatLsResult(
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  const details = result.details as LsToolDetails | undefined;
  const textContent = extractTextContent(result);

  if (state.isError) {
    return formatSimpleErrorResult(textContent, state, options, theme);
  }

  const hint = buildHint(theme);

  const normalized = normalizeOutput(textContent);
  if (normalized === "" || normalized === "(empty directory)") {
    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("muted", "(empty directory)")
    );
  }

  const entries = normalized.split("\n");
  const totalEntries = entries.length;

  const summaryParts: string[] = [];
  summaryParts.push(
    `${totalEntries} ${totalEntries === 1 ? "entry" : "entries"}`,
  );

  if (details?.entryLimitReached !== undefined) {
    summaryParts.push(
      theme.fg("warning", `${details.entryLimitReached} limit`),
    );
  }
  if (details?.truncation?.truncated) {
    summaryParts.push(theme.fg("warning", "truncated"));
  }

  const summary = summaryParts.join(theme.fg("toolOutput", ", "));

  if (!options.expanded) {
    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("toolOutput", summary) +
      hint
    );
  }

  const visibleEntries = entries.slice(0, MAX_EXPANDED_ENTRIES);
  const remaining = Math.max(0, totalEntries - MAX_EXPANDED_ENTRIES);

  const lines: string[] = [];

  lines.push(
    theme.fg(getResultSymbolColor(state), "├─ ") +
      theme.fg("toolOutput", summary),
  );

  visibleEntries.forEach((entry, index) => {
    const isLastVisible =
      index === visibleEntries.length - 1 && remaining === 0;
    const prefix: "│  " | "└─ " = isLastVisible ? "└─ " : "│  ";

    const coloredEntry = isDirectoryEntry(entry)
      ? theme.fg("success", entry)
      : entry;

    const treeLine = formatTreeLine(coloredEntry, {
      theme,
      state,
      prefix,
      width: MAX_CALL_WIDTH - 1,
      mode: "preserve",
    });
    lines.push(treeLine.text);
  });

  if (remaining > 0) {
    lines.push(
      theme.fg(getResultSymbolColor(state), "└─ ") +
        theme.fg("muted", `${remaining} more entries`),
    );
  }

  return lines.join("\n");
}

export function patchLsTool(pi: ExtensionAPI, ctx: ExtensionContext): Handle {
  const tool = createLsTool(ctx.cwd);

  return registerPatchedTool({
    pi,
    tool,
    name: "ls",
    label: "ls",
    promptSnippet: TOOL_PROMPTS.ls.promptSnippet,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      let content = prefix;

      const renderArgs = args as LsToolInput;
      const title = theme.fg("toolTitle", theme.bold("Ls "));
      const limit = renderArgs.limit
        ? theme.fg("muted", ` (limit ${renderArgs.limit})`)
        : "";
      const pathWidth = Math.max(
        1,
        MAX_CALL_WIDTH - visibleWidth(content + title + limit),
      );
      const pathDisplay = renderPath(
        renderArgs.path,
        theme,
        toolCtx.cwd,
        pathWidth,
      );

      content += title;
      content += pathDisplay;
      content += limit;

      text.setText(
        truncateToWidth(content, MAX_CALL_WIDTH, theme.fg("accent", "...")),
      );
      return text;
    },
    renderResult(result, options, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const text = getResultText(state, options, toolCtx.lastComponent);

      const details = result.details as LsToolDetails | undefined;

      const changed = updateResultState(state, {
        truncated: details?.truncation?.truncated === true,
        isError: toolCtx.isError,
      });

      invalidateIfChanged(changed, toolCtx.invalidate);

      text.setText(formatLsResult(result, state, options, theme));
      return text;
    },
  });
}
