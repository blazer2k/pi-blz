import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { buildExpansionHint } from "../rendering/state";
import { formatTreeLine } from "../rendering/tree";
import { buildBashMetadataParts, joinMetadata } from "./metadata";
import type { BashSuccessView } from "./model";
import {
  formatHiddenLinesLabel,
  formatOutputLines,
  getBashOutputWidth,
} from "./output";

function buildSuccessMetadata(
  view: BashSuccessView,
  lineTruncated: boolean,
  theme: Theme,
): { metadata: string; needsHint: boolean } {
  const { parts, needsHint } = buildBashMetadataParts(
    {
      durationSummary: view.durationSummary,
      remainingLines: view.output.remainingLines,
      visibleLines: view.output.visibleLines,
      callExpandable: view.callExpandable,
      lineTruncated,
      toolTruncated: view.toolTruncated,
      expanded: view.expanded,
    },
    theme,
  );
  return { metadata: joinMetadata(parts, theme), needsHint };
}

function buildCollapsedSummary(
  metadata: string,
  needsHint: boolean,
  theme: Theme,
): string {
  if (!needsHint) return metadata || theme.fg("muted", "output");
  return (
    metadata +
    buildExpansionHint(theme, "expand", metadata ? "suffix" : "standalone")
  );
}

function renderStructuredSingleLine(
  output: string,
  metadata: string,
  collapsedSummary: string,
  view: BashSuccessView,
  theme: Theme,
): string {
  const summary = view.expanded
    ? metadata +
      buildExpansionHint(theme, "collapse", metadata ? "suffix" : "standalone")
    : collapsedSummary;
  const outputLine = output
    ? formatTreeLine(output, {
        theme,
        prefix: "╰─ ",
        width: getBashOutputWidth() + 3,
        mode: view.expanded ? "preserve" : "truncate",
        color: "toolOutput",
      }).text
    : undefined;

  return [
    summary ? theme.fg("dim", outputLine ? "├─ " : "╰─ ") + summary : undefined,
    outputLine,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function renderSingleLineSuccess(view: BashSuccessView, theme: Theme): string {
  const inlineOutput = view.output.visibleText;
  const maxLineWidth = getBashOutputWidth();
  const lineTruncated =
    !view.expanded && visibleWidth(inlineOutput) > maxLineWidth;
  const renderedOutput = lineTruncated
    ? truncateToWidth(inlineOutput, maxLineWidth, theme.fg("toolOutput", "..."))
    : inlineOutput;
  const { metadata, needsHint } = buildSuccessMetadata(
    view,
    lineTruncated,
    theme,
  );
  const collapsedSummary = buildCollapsedSummary(metadata, needsHint, theme);
  const inlineParts = [
    metadata,
    inlineOutput ? theme.fg("toolOutput", renderedOutput) : undefined,
  ]
    .filter(Boolean)
    .join(theme.fg("muted", " • "));
  const inline =
    (inlineParts || collapsedSummary) +
    (view.expanded ? buildExpansionHint(theme, "collapse") : "");
  const structured =
    needsHint || (view.expanded && visibleWidth(inline) > maxLineWidth);

  return structured
    ? renderStructuredSingleLine(
        renderedOutput,
        metadata,
        collapsedSummary,
        view,
        theme,
      )
    : theme.fg("dim", "╰─ ") + inline;
}

function renderMultiLineSuccess(view: BashSuccessView, theme: Theme): string {
  const outputLines = formatOutputLines(
    view.output.visibleText,
    theme,
    "toolOutput",
    view.expanded ? undefined : getBashOutputWidth(),
    { closeLastLine: true },
  );
  const { metadata, needsHint } = buildSuccessMetadata(
    view,
    outputLines.truncated,
    theme,
  );
  const summary = view.expanded
    ? (metadata || theme.fg("muted", "output")) +
      buildExpansionHint(theme, "collapse")
    : buildCollapsedSummary(metadata, needsHint, theme);

  return [
    theme.fg("dim", outputLines.text ? "├─ " : "╰─ ") + summary,
    view.output.hiddenLines > 0
      ? formatHiddenLinesLabel(view.output.hiddenLines, theme)
      : undefined,
    outputLines.text,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function renderBashSuccess(view: BashSuccessView, theme: Theme): string {
  return view.output.totalLines <= 1
    ? renderSingleLineSuccess(view, theme)
    : renderMultiLineSuccess(view, theme);
}
