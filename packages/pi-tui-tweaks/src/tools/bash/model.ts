import type {
  BashToolDetails,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { formatErrorBody } from "../rendering/results";
import { extractTextContent } from "../rendering/text";
import { selectOutputWindow, type OutputWindow } from "../rendering/output";
import { getDurationSummary } from "./metadata";
import { parseBashErrorText, stripBashTruncationNotice } from "./native-output";
import type { ToolTextResult } from "../rendering/types";
import type { BashRenderState } from "./types";

type BaseBashResultView = {
  expanded: boolean;
  collapsedDisplay: "preview" | "summary";
  durationSummary?: string;
  callExpandable: boolean;
  toolTruncated: boolean;
};

export type BashSuccessView = BaseBashResultView & {
  kind: "success";
  output: OutputWindow;
};

export type BashCommandErrorView = BaseBashResultView & {
  kind: "command-error";
  output: OutputWindow;
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
  errorWidth: number;
};

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
      output: selectOutputWindow(error.output, policy.collapsedDisplay),
      status: error.status,
    };
  }

  const collapsedBody = formatErrorBody(
    error.output,
    { ...options, expanded: false },
    policy.errorWidth,
    policy.errorEllipsis,
  );
  const expandedBody = formatErrorBody(
    error.output,
    { ...options, expanded: true },
    policy.errorWidth,
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
  result: ToolTextResult,
  state: BashRenderState,
  options: ToolRenderResultOptions,
  policy: BashResultPolicy,
): BashResultView {
  const details = result.details as BashToolDetails | undefined;
  const rawText = extractTextContent(result);
  const base: BaseBashResultView = {
    expanded: options.expanded,
    collapsedDisplay: policy.collapsedDisplay,
    durationSummary: getDurationSummary(state, options),
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
    output: selectOutputWindow(output, policy.collapsedDisplay),
  };
}
