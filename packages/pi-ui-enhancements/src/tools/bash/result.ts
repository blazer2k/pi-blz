import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { extractTextContent } from "../tool-rendering";
import { formatErrorResult } from "./error-result";
import { getDurationSummary } from "./metadata";
import { stripBashTruncationNotice } from "./output";
import { formatSuccessfulResult } from "./success-result";
import type {
  BashDetailsWithTiming,
  BashRenderState,
  BashResult,
} from "./types";

export function formatBashResult(
  result: BashResult,
  state: BashRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  const details = result.details as BashDetailsWithTiming | undefined;
  const rawText = extractTextContent(result);
  const text = state.isError
    ? rawText
    : stripBashTruncationNotice(rawText, details);
  const durationSummary = getDurationSummary(details, state, options);

  return state.isError
    ? formatErrorResult(text, state, options, theme, durationSummary)
    : formatSuccessfulResult(text, state, options, theme, durationSummary);
}
