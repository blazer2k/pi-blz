import type { Theme } from "@earendil-works/pi-coding-agent";
import { buildExpansionHint } from "../rendering/state";
import { buildBashMetadataParts, joinMetadata } from "./metadata";
import type { BashSuccessView } from "./model";
import type { BashRenderState } from "./types";
import { formatCollapsedBashOutput, formatOutputLines } from "./output";

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

export function renderBashSuccess(
  view: BashSuccessView,
  theme: Theme,
  state: BashRenderState,
): string {
  const collapsedOutput = formatCollapsedBashOutput(view.output, theme);
  const outputHidden = view.output.hiddenLines > 0;
  const expandable =
    view.callExpandable ||
    outputHidden ||
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
  if (view.output.totalLines === 0) {
    metadataParts.push(theme.fg("muted", "(no output)"));
  }

  let metadata = joinMetadata(metadataParts, theme);
  const hint = buildHint(expandable, expanded, Boolean(metadata), theme);
  if (!metadata && !hint) metadata = theme.fg("muted", "output");
  const footer = metadata + hint;

  return [output.text, theme.fg("dim", "╰─ ") + footer]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
