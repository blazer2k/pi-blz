import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  buildExpansionHint,
  countLines,
  formatTreeLine,
  getMaxCollapsedLines,
  normalizeOutput,
} from "../tool-rendering";
import { buildBashMetadataParts, joinMetadata } from "./metadata";
import {
  formatHiddenLinesLabel,
  formatOutputLines,
  getBashOutputWidth,
} from "./output";
import type { BashRenderState } from "./types";

function formatSingleLineResult(
  output: string,
  fallbackSummary: string,
  state: BashRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  durationSummary: string | undefined,
): string {
  const inlineOutput =
    options.expanded || getMaxCollapsedLines() > 0 ? output : "";
  const maxLineWidth = getBashOutputWidth();
  const shouldTruncate =
    !options.expanded && visibleWidth(inlineOutput) > maxLineWidth;
  const renderedOutput = shouldTruncate
    ? truncateToWidth(inlineOutput, maxLineWidth, theme.fg("toolOutput", "..."))
    : inlineOutput;
  const { parts, needsHint } = buildBashMetadataParts(
    {
      durationSummary,
      callExpandable: state.callExpandable,
      lineTruncated: shouldTruncate,
      toolTruncated: state.truncated === true,
      expanded: options.expanded,
    },
    theme,
  );
  const metadata = joinMetadata(parts, theme);
  const metadataSummary =
    metadata +
    (needsHint
      ? buildExpansionHint(
          theme,
          options.expanded ? "collapse" : "expand",
          metadata ? "suffix" : "standalone",
        )
      : "");
  const inlineParts = [
    metadata,
    inlineOutput ? theme.fg("toolOutput", renderedOutput) : undefined,
  ]
    .filter(Boolean)
    .join(theme.fg("muted", " • "));
  const expandedInline =
    (inlineParts || fallbackSummary) +
    (options.expanded ? buildExpansionHint(theme, "collapse") : "");
  const useStructuredResult =
    needsHint ||
    (options.expanded && visibleWidth(expandedInline) > getBashOutputWidth());

  if (!useStructuredResult) {
    return theme.fg("dim", "╰─ ") + expandedInline;
  }

  const structuredMetadata = options.expanded
    ? metadata +
      buildExpansionHint(theme, "collapse", metadata ? "suffix" : "standalone")
    : metadataSummary;
  const outputLine = renderedOutput
    ? formatTreeLine(renderedOutput, {
        theme,
        prefix: "╰─ ",
        width: getBashOutputWidth() + 3,
        mode: options.expanded ? "preserve" : "truncate",
        color: "toolOutput",
      }).text
    : undefined;
  return [
    structuredMetadata
      ? theme.fg("dim", outputLine ? "├─ " : "╰─ ") + structuredMetadata
      : undefined,
    outputLine,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function formatSuccessfulResult(
  text: string,
  state: BashRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  durationSummary: string | undefined,
): string {
  const output = normalizeOutput(text).replace(/\n+$/g, "");
  const limit = getMaxCollapsedLines();
  const lineCount = countLines(output);
  const showExpanded = options.expanded && lineCount > 1;
  const visibleLineCount = showExpanded
    ? lineCount
    : limit === 0
      ? 0
      : Math.min(lineCount, limit);
  const remainingLines = Math.max(0, lineCount - visibleLineCount);
  const visibleOutput = showExpanded
    ? output
    : limit === 0
      ? ""
      : output.split("\n").slice(-limit).join("\n");
  const hiddenLines =
    showExpanded || visibleLineCount === 0 ? 0 : remainingLines;
  const outputLines = formatOutputLines(
    visibleOutput,
    theme,
    "toolOutput",
    showExpanded ? undefined : getBashOutputWidth(),
    { closeLastLine: true },
  );
  const { parts, needsHint } = buildBashMetadataParts(
    {
      durationSummary,
      remainingLines,
      visibleLines: visibleLineCount,
      callExpandable: state.callExpandable,
      lineTruncated: outputLines.truncated,
      toolTruncated: state.truncated === true,
      expanded: options.expanded,
    },
    theme,
  );
  const metadata = joinMetadata(parts, theme);
  const summaryBase = metadata || theme.fg("muted", "output");
  const summary = showExpanded
    ? summaryBase + buildExpansionHint(theme, "collapse")
    : needsHint
      ? metadata +
        buildExpansionHint(theme, "expand", metadata ? "suffix" : "standalone")
      : summaryBase;

  if (lineCount <= 1) {
    return formatSingleLineResult(
      output,
      summary,
      state,
      options,
      theme,
      durationSummary,
    );
  }

  return [
    theme.fg("dim", outputLines.text ? "├─ " : "╰─ ") + summary,
    hiddenLines > 0 ? formatHiddenLinesLabel(hiddenLines, theme) : undefined,
    outputLines.text,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
