import type { Theme } from "@earendil-works/pi-coding-agent";
import { buildExpansionHint } from "../rendering/state";
import { buildBashMetadataParts, joinMetadata } from "./metadata";
import type { BashCommandErrorView, BashUnknownErrorView } from "./model";
import {
  formatHiddenLinesLabel,
  formatOutputLines,
  getBashOutputWidth,
} from "./output";

function buildErrorMetadata(
  view: BashCommandErrorView | BashUnknownErrorView,
  theme: Theme,
  output?: { remainingLines: number; visibleLines: number },
): string {
  const { parts } = buildBashMetadataParts(
    {
      durationSummary: view.durationSummary,
      remainingLines: output?.remainingLines,
      visibleLines: output?.visibleLines,
      toolTruncated: view.toolTruncated,
      expanded: view.expanded,
    },
    theme,
  );
  return joinMetadata(parts, theme);
}

function buildErrorHint(
  expandable: boolean,
  expanded: boolean,
  metadata: string,
  theme: Theme,
): string {
  if (!expandable) return "";
  return buildExpansionHint(
    theme,
    expanded ? "collapse" : "expand",
    metadata ? "suffix" : "standalone",
  );
}

function renderExpandedUnknownError(
  view: BashUnknownErrorView,
  metadata: string,
  hint: string,
  theme: Theme,
): string {
  const output = formatOutputLines(view.body.text, theme, "error", undefined, {
    closeLastLine: true,
  }).text;
  const summary = metadata + hint;
  return [
    summary ? theme.fg("dim", output ? "├─ " : "╰─ ") + summary : undefined,
    output,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function renderUnknownError(
  view: BashUnknownErrorView,
  theme: Theme,
): string {
  const metadata = buildErrorMetadata(view, theme);
  const hint = buildErrorHint(view.expandable, view.expanded, metadata, theme);
  if (view.expanded) {
    return renderExpandedUnknownError(view, metadata, hint, theme);
  }

  const body = view.body.text || "error";
  const summary = [metadata, theme.fg("error", body)]
    .filter(Boolean)
    .join(theme.fg("muted", " • "));
  return theme.fg("dim", "╰─ ") + summary + hint;
}

export function renderCommandError(
  view: BashCommandErrorView,
  theme: Theme,
): string {
  const collapsedOutput = formatOutputLines(
    view.output.collapsedText,
    theme,
    "toolOutput",
    getBashOutputWidth(),
  );
  const expandable =
    view.output.collapsedRemainingLines > 0 ||
    collapsedOutput.truncated ||
    view.callExpandable ||
    view.toolTruncated;
  const output = view.expanded
    ? formatOutputLines(view.output.visibleText, theme, "toolOutput")
    : collapsedOutput;
  const metadata = buildErrorMetadata(view, theme, view.output);
  const hint = buildErrorHint(expandable, view.expanded, metadata, theme);
  const summary = metadata + hint;

  return [
    summary ? theme.fg("dim", "├─ ") + summary : undefined,
    view.output.hiddenLines > 0
      ? formatHiddenLinesLabel(view.output.hiddenLines, theme)
      : undefined,
    output.text,
    theme.fg("dim", "╰─ ") + theme.fg("error", view.status),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
