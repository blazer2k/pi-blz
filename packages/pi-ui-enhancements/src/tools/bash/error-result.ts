import type { Theme } from "@earendil-works/pi-coding-agent";
import { buildExpansionHint } from "../rendering/state";
import { buildBashMetadataParts, joinMetadata } from "./metadata";
import type { BashCommandErrorView, BashUnknownErrorView } from "./model";
import type { BashRenderState } from "./types";
import {
  formatCollapsedBashOutput,
  formatOutputLines,
  getBashOutputWidth,
} from "./output";

function buildHint(
  expandable: boolean,
  expanded: boolean,
  hasMetadata: boolean,
  theme: Theme,
): string {
  if (!expandable) return "";
  return buildExpansionHint(
    theme,
    expanded ? "collapse" : "expand",
    hasMetadata ? "suffix" : "standalone",
  );
}

export function renderUnknownError(
  view: BashUnknownErrorView,
  theme: Theme,
  state: BashRenderState,
): string {
  const expandable =
    view.callExpandable || view.body.collapsedTruncated || view.toolTruncated;
  state.resultExpandable = expandable;
  const expanded = view.expanded && expandable;
  const metadataParts = buildBashMetadataParts(
    {
      durationSummary: view.durationSummary,
      toolTruncated: view.toolTruncated,
    },
    theme,
  );
  const metadata = joinMetadata(metadataParts, theme);
  const hint = buildHint(expandable, expanded, Boolean(metadata), theme);
  const footer = metadata + hint;
  const body = expanded ? view.body.expandedText : view.body.collapsedText;
  const output = formatOutputLines(
    body || "error",
    theme,
    "error",
    expanded ? undefined : getBashOutputWidth(),
    { closeLastLine: !footer },
  ).text;

  return [output, footer ? theme.fg("dim", "╰─ ") + footer : undefined]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function renderCommandError(
  view: BashCommandErrorView,
  theme: Theme,
  state: BashRenderState,
): string {
  const collapsedOutput = formatCollapsedBashOutput(view.output, theme);
  const expandable =
    view.callExpandable ||
    view.output.hiddenLines > 0 ||
    collapsedOutput.truncated ||
    view.toolTruncated;
  state.resultExpandable = expandable;
  const expanded = view.expanded && expandable;
  const output = expanded
    ? formatOutputLines(view.output.fullText, theme, "toolOutput")
    : collapsedOutput;
  const metadataParts = buildBashMetadataParts(
    {
      durationSummary: view.durationSummary,
      totalLines: view.output.totalLines,
      includeLineCount:
        !expanded &&
        view.collapsedDisplay === "summary" &&
        view.output.totalLines > 0,
      toolTruncated: view.toolTruncated,
    },
    theme,
  );
  const metadata = joinMetadata(metadataParts, theme);
  const hint = buildHint(expandable, expanded, Boolean(metadata), theme);
  const footer = metadata + hint;

  return [
    output.text,
    theme.fg("dim", footer ? "├─ " : "╰─ ") + theme.fg("error", view.status),
    footer ? theme.fg("dim", "╰─ ") + footer : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
