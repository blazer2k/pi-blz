import type { ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { formatErrorBody } from "../rendering/results";
import {
  countLines,
  extractTextContent,
  normalizeOutput,
} from "../rendering/text";
import { getDurationSummary } from "./metadata";
import { parseBashErrorText, stripBashTruncationNotice } from "./native-output";
import type {
  BashDetailsWithTiming,
  BashRenderState,
  BashResult,
} from "./types";

export type BashOutputWindow = {
  collapsedText: string;
  visibleText: string;
  totalLines: number;
  collapsedRemainingLines: number;
  visibleLines: number;
  remainingLines: number;
  hiddenLines: number;
};

type BaseBashResultView = {
  expanded: boolean;
  durationSummary?: string;
  callExpandable: boolean;
  toolTruncated: boolean;
};

export type BashSuccessView = BaseBashResultView & {
  kind: "success";
  output: BashOutputWindow;
};

export type BashCommandErrorView = BaseBashResultView & {
  kind: "command-error";
  output: BashOutputWindow;
  status: string;
};

export type BashUnknownErrorView = BaseBashResultView & {
  kind: "unknown-error";
  body: { text: string; truncated: boolean };
  expandable: boolean;
};

export type BashResultView =
  | BashSuccessView
  | BashCommandErrorView
  | BashUnknownErrorView;

export type BashResultPolicy = {
  collapsedLineLimit: number;
  errorEllipsis: string;
};

export function selectBashOutputWindow(
  text: string,
  expanded: boolean,
  collapsedLimit: number,
): BashOutputWindow {
  const fullText = normalizeOutput(text).replace(/\n+$/g, "");
  const totalLines = countLines(fullText);
  const collapsedVisibleLines =
    collapsedLimit === 0 ? 0 : Math.min(totalLines, collapsedLimit);
  const collapsedRemainingLines = Math.max(
    0,
    totalLines - collapsedVisibleLines,
  );
  const collapsedText =
    collapsedLimit === 0
      ? ""
      : fullText.split("\n").slice(-collapsedLimit).join("\n");
  const visibleLines = expanded ? totalLines : collapsedVisibleLines;
  const remainingLines = expanded ? 0 : collapsedRemainingLines;

  return {
    collapsedText,
    visibleText: expanded ? fullText : collapsedText,
    totalLines,
    collapsedRemainingLines,
    visibleLines,
    remainingLines,
    hiddenLines: visibleLines === 0 ? 0 : remainingLines,
  };
}

function buildErrorView(
  rawText: string,
  state: BashRenderState,
  options: ToolRenderResultOptions,
  policy: BashResultPolicy,
  base: BaseBashResultView,
): BashCommandErrorView | BashUnknownErrorView {
  const error = parseBashErrorText(rawText);
  if (error.status) {
    return {
      ...base,
      kind: "command-error",
      output: selectBashOutputWindow(
        error.output,
        options.expanded,
        policy.collapsedLineLimit,
      ),
      status: error.status,
    };
  }

  const collapsedBody = formatErrorBody(
    error.output,
    { ...options, expanded: false },
    policy.errorEllipsis,
  );
  const body = options.expanded
    ? formatErrorBody(error.output, options, policy.errorEllipsis)
    : collapsedBody;

  return {
    ...base,
    kind: "unknown-error",
    body,
    expandable:
      collapsedBody.truncated ||
      state.callExpandable === true ||
      state.truncated === true,
  };
}

export function buildBashResultView(
  result: BashResult,
  state: BashRenderState,
  options: ToolRenderResultOptions,
  policy: BashResultPolicy,
): BashResultView {
  const details = result.details as BashDetailsWithTiming | undefined;
  const rawText = extractTextContent(result);
  const base: BaseBashResultView = {
    expanded: options.expanded,
    durationSummary: getDurationSummary(details, state, options),
    callExpandable: state.callExpandable === true,
    toolTruncated: state.truncated === true,
  };

  if (state.isError) {
    return buildErrorView(rawText, state, options, policy, base);
  }

  const output = stripBashTruncationNotice(rawText, details);
  return {
    ...base,
    kind: "success",
    output: selectBashOutputWindow(
      output,
      options.expanded,
      policy.collapsedLineLimit,
    ),
  };
}
