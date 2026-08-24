import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  buildExpansionHint,
  countLines,
  formatErrorBody,
  getMaxCollapsedLines,
  normalizeOutput,
} from "../tool-rendering";
import { buildBashMetadataParts, joinMetadata } from "./metadata";
import {
  formatHiddenLinesLabel,
  formatOutputLines,
  getBashOutputWidth,
  parseBashErrorText,
} from "./output";
import type { BashRenderState } from "./types";

function formatUnknownError(
  output: string,
  state: BashRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  durationSummary: string | undefined,
): string {
  const collapsedBody = formatErrorBody(
    output,
    { ...options, expanded: false },
    theme.fg("error", "..."),
  );
  const errorBody = options.expanded
    ? formatErrorBody(output, options, theme.fg("error", "..."))
    : collapsedBody;
  const metadata = joinMetadata(
    buildBashMetadataParts(
      {
        toolTruncated: state.truncated === true,
        durationSummary,
        expanded: options.expanded,
      },
      theme,
    ).parts,
    theme,
  );
  const isExpandable =
    collapsedBody.truncated ||
    state.callExpandable === true ||
    state.truncated === true;
  const expansionHint = isExpandable
    ? buildExpansionHint(
        theme,
        options.expanded ? "collapse" : "expand",
        metadata ? "suffix" : "standalone",
      )
    : "";

  if (options.expanded) {
    const outputLines = formatOutputLines(
      errorBody.text,
      theme,
      "error",
      undefined,
      { closeLastLine: true },
    );
    const summary = metadata + expansionHint;
    return [
      summary
        ? theme.fg("dim", outputLines.text ? "├─ " : "╰─ ") + summary
        : undefined,
      outputLines.text,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  const body = errorBody.text || "error";
  const summary = [metadata, theme.fg("error", body)]
    .filter(Boolean)
    .join(theme.fg("muted", " • "));
  return theme.fg("dim", "╰─ ") + summary + expansionHint;
}

function formatStatusError(
  output: string,
  status: string,
  state: BashRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  durationSummary: string | undefined,
): string {
  const limit = getMaxCollapsedLines();
  const errorLineCount = countLines(output);
  const collapsedVisibleLineCount =
    limit === 0 ? 0 : Math.min(errorLineCount, limit);
  const remainingLines = Math.max(
    0,
    errorLineCount - collapsedVisibleLineCount,
  );
  const collapsedOutput =
    limit === 0
      ? ""
      : normalizeOutput(output).split("\n").slice(-limit).join("\n");
  const collapsedOutputLines = formatOutputLines(
    collapsedOutput,
    theme,
    "toolOutput",
    getBashOutputWidth(),
  );
  const isExpandable =
    remainingLines > 0 ||
    collapsedOutputLines.truncated ||
    state.callExpandable === true ||
    state.truncated === true;
  const visibleOutput = options.expanded
    ? normalizeOutput(output)
    : collapsedOutput;
  const outputLines = options.expanded
    ? formatOutputLines(visibleOutput, theme, "toolOutput")
    : collapsedOutputLines;
  const metadata = joinMetadata(
    buildBashMetadataParts(
      {
        durationSummary,
        remainingLines: options.expanded ? 0 : remainingLines,
        visibleLines: options.expanded
          ? errorLineCount
          : collapsedVisibleLineCount,
        toolTruncated: state.truncated === true,
        expanded: options.expanded,
      },
      theme,
    ).parts,
    theme,
  );
  const expansionHint = isExpandable
    ? buildExpansionHint(
        theme,
        options.expanded ? "collapse" : "expand",
        metadata ? "suffix" : "standalone",
      )
    : "";
  const summary = metadata + expansionHint;
  const showHiddenLabel =
    !options.expanded && collapsedVisibleLineCount > 0 && remainingLines > 0;

  return [
    summary ? theme.fg("dim", "├─ ") + summary : undefined,
    showHiddenLabel ? formatHiddenLinesLabel(remainingLines, theme) : undefined,
    outputLines.text,
    theme.fg("dim", "╰─ ") + theme.fg("error", status),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function formatErrorResult(
  text: string,
  state: BashRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  durationSummary: string | undefined,
): string {
  const error = parseBashErrorText(text);
  return error.status
    ? formatStatusError(
        error.output,
        error.status,
        state,
        options,
        theme,
        durationSummary,
      )
    : formatUnknownError(error.output, state, options, theme, durationSummary);
}
