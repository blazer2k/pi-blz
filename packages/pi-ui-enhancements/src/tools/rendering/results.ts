import type {
  ExtensionAPI,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  buildExpansionHint,
  buildResultStatusParts,
  buildToolExpansionHint,
  getMaxCallWidth,
  getMaxExpandedEntries,
  invalidateIfChanged,
  updateResultState,
} from "./state";
import { extractTextContent, normalizeOutput } from "./text";
import { formatTreeLine, getResultText } from "./tree";
import type {
  BaseRenderState,
  FormatResultFn,
  ListResultConfig,
  ResultStatusState,
  ToolTextResult,
} from "./types";

export function getMaxErrorLineWidth(): number {
  return Math.floor(getMaxCallWidth() / 2);
}

export function formatErrorBody(
  textContent: string,
  options: ToolRenderResultOptions,
  ellipsis = "...",
): { text: string; truncated: boolean } {
  const output = normalizeOutput(textContent);
  const lines = output.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  const trimmed = lines.slice(0, end);

  if (options.expanded) {
    return { text: trimmed.join("\n"), truncated: false };
  }
  if (trimmed.length === 0) return { text: "", truncated: false };

  const maxLineWidth = getMaxErrorLineWidth();
  const firstLine = trimmed.find((line) => line.length > 0) ?? "";

  if (trimmed.length === 1 && visibleWidth(firstLine) <= maxLineWidth) {
    return { text: firstLine, truncated: false };
  }

  if (trimmed.length > 1) {
    return {
      text: truncateToWidth(
        `${firstLine}${firstLine ? " " : ""}${ellipsis}`,
        maxLineWidth,
        ellipsis,
      ),
      truncated: true,
    };
  }

  return {
    text: truncateToWidth(firstLine, maxLineWidth, ellipsis),
    truncated: true,
  };
}

export function formatSimpleErrorResult(
  textContent: string,
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  const collapsedBody = formatErrorBody(
    textContent,
    { ...options, expanded: false },
    theme.fg("error", "..."),
  );
  const errorBody = options.expanded
    ? formatErrorBody(textContent, options, theme.fg("error", "..."))
    : collapsedBody;
  const hasErrorBody = errorBody.text.length > 0;
  const bodyText = hasErrorBody ? errorBody.text : "error";
  const maxWidth = getMaxCallWidth();

  const formatted = bodyText
    .split("\n")
    .map((line, index, lines) => {
      const prefix = index === lines.length - 1 ? "╰─ " : "│  ";
      return formatTreeLine(line, {
        theme,
        prefix,
        width: maxWidth - 1,
        mode: "preserve",
        color: "error",
      }).text;
    })
    .join("\n");

  const status = state.truncated
    ? buildResultStatusParts(state, theme).join(theme.fg("muted", " • "))
    : "";
  const isExpandable =
    state.callExpandable === true || state.truncated || collapsedBody.truncated;

  if (options.expanded) {
    if (!isExpandable) return formatted;

    const collapseHint = buildExpansionHint(
      theme,
      "collapse",
      status ? "suffix" : "standalone",
    );
    if (!status && !collapseHint) return formatted;

    return theme.fg("dim", "├─ ") + status + collapseHint + "\n" + formatted;
  }

  const suffix = isExpandable ? buildExpansionHint(theme, "expand") : "";
  if (!state.truncated) {
    return theme.fg("dim", "╰─ ") + theme.fg("error", bodyText) + suffix;
  }

  return (
    theme.fg("dim", "╰─ ") +
    status +
    (hasErrorBody
      ? theme.fg("muted", " • ") + theme.fg("error", bodyText)
      : "") +
    suffix
  );
}

export function formatListResult(
  result: ToolTextResult,
  state: ResultStatusState,
  options: ToolRenderResultOptions,
  theme: Theme,
  config: ListResultConfig,
): string {
  if (state.isError) {
    return formatSimpleErrorResult(
      extractTextContent(result),
      state,
      options,
      theme,
    );
  }

  const normalized = normalizeOutput(extractTextContent(result));
  if (normalized === "" || normalized === config.emptyMessage) {
    const emptyParts = buildResultStatusParts(state, theme);
    emptyParts.push(theme.fg("muted", config.emptyMessage));
    return (
      theme.fg("dim", "╰─ ") +
      emptyParts.join(theme.fg("muted", " • ")) +
      buildToolExpansionHint(theme, state, options, false)
    );
  }

  const items = config.preprocess(normalized);
  const total = items.length;
  const label = total === 1 ? config.singularLabel : config.pluralLabel;
  const summaryParts = buildResultStatusParts(state, theme);
  summaryParts.push(theme.fg("muted", `${total} ${label}`));
  const summary = summaryParts.join(theme.fg("muted", " • "));

  if (!options.expanded) {
    return (
      theme.fg("dim", "╰─ ") +
      summary +
      buildToolExpansionHint(theme, state, options, true)
    );
  }

  const maxEntries = getMaxExpandedEntries();
  const visible = items.slice(0, maxEntries);
  const remaining = Math.max(0, total - maxEntries);
  const lines: string[] = [
    theme.fg("dim", "├─ ") +
      summary +
      buildToolExpansionHint(theme, state, options, true),
  ];

  visible.forEach((item, index) => {
    const isLast = index === visible.length - 1 && remaining === 0;
    const rendered = config.renderItem ? config.renderItem(item, theme) : item;
    lines.push(
      formatTreeLine(rendered, {
        theme,
        prefix: isLast ? "╰─ " : "│  ",
        width: getMaxCallWidth() - 1,
        mode: "preserve",
        color: "toolOutput",
      }).text,
    );
  });

  if (remaining > 0) {
    lines.push(
      theme.fg("dim", "╰─ ") +
        theme.fg("muted", `${remaining} ${config.moreLabel}`),
    );
  }

  return lines.join("\n");
}

export function buildRenderResult(
  formatResult: FormatResultFn,
  isTruncated?: (details: unknown) => boolean,
): NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["renderResult"]> {
  return (result, options, theme, toolContext) => {
    const state = toolContext.state as BaseRenderState;
    const text = getResultText(state, options, toolContext.lastComponent);
    const details = result.details as
      | { truncation?: { truncated?: boolean } }
      | undefined;

    const changed = updateResultState(state, {
      truncated: isTruncated
        ? isTruncated(result.details)
        : details?.truncation?.truncated === true,
      isError: toolContext.isError,
    });

    invalidateIfChanged(changed, toolContext.invalidate);
    text.setText(
      formatResult(result, state as ResultStatusState, options, theme),
    );
    return text;
  };
}
