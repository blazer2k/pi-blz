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

const BASH_PREVIEW_ROWS = 5;
const BASH_PREVIEW_EDGE_LINES = 2;

export type BashOutputWindow = {
  fullText: string;
  previewHeadLines: string[];
  previewTailLines: string[];
  totalLines: number;
  hiddenLines: number;
};

type BaseBashResultView = {
  expanded: boolean;
  collapsedDisplay: "preview" | "summary";
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
  body: {
    collapsedText: string;
    expandedText: string;
    collapsedTruncated: boolean;
  };
};

export type BashResultView =
  | BashSuccessView
  | BashCommandErrorView
  | BashUnknownErrorView;

export type BashResultPolicy = {
  collapsedDisplay: "preview" | "summary";
  errorEllipsis: string;
};

export function selectBashOutputWindow(
  text: string,
  collapsedDisplay: "preview" | "summary",
): BashOutputWindow {
  const fullText = normalizeOutput(text).replace(/\n+$/g, "");
  const totalLines = countLines(fullText);
  const lines = totalLines === 0 ? [] : fullText.split("\n");

  if (collapsedDisplay === "summary" || totalLines === 0) {
    return {
      fullText,
      previewHeadLines: [],
      previewTailLines: [],
      totalLines,
      hiddenLines: totalLines,
    };
  }

  if (totalLines <= BASH_PREVIEW_ROWS) {
    return {
      fullText,
      previewHeadLines: lines,
      previewTailLines: [],
      totalLines,
      hiddenLines: 0,
    };
  }

  return {
    fullText,
    previewHeadLines: lines.slice(0, BASH_PREVIEW_EDGE_LINES),
    previewTailLines: lines.slice(-BASH_PREVIEW_EDGE_LINES),
    totalLines,
    hiddenLines: totalLines - BASH_PREVIEW_EDGE_LINES * 2,
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
      output: selectBashOutputWindow(error.output, policy.collapsedDisplay),
      status: error.status,
    };
  }

  const collapsedBody = formatErrorBody(
    error.output,
    { ...options, expanded: false },
    policy.errorEllipsis,
  );
  const expandedBody = formatErrorBody(
    error.output,
    { ...options, expanded: true },
    policy.errorEllipsis,
  );

  return {
    ...base,
    kind: "unknown-error",
    body: {
      collapsedText: collapsedBody.text,
      expandedText: expandedBody.text,
      collapsedTruncated: collapsedBody.truncated,
    },
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
    collapsedDisplay: policy.collapsedDisplay,
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
    output: selectBashOutputWindow(output, policy.collapsedDisplay),
  };
}
