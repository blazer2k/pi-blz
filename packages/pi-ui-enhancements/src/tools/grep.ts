import type {
  ExtensionAPI,
  GrepToolDetails,
  GrepToolInput,
} from "@earendil-works/pi-coding-agent";
import { createGrepTool } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
import { TOOL_PROMPTS } from "./tool-prompts";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";
import {
  type BaseRenderState,
  type ListResultConfig,
  MAX_CALL_WIDTH,
  buildRenderResult,
  formatListResult,
  getCallRenderParts,
  renderPath,
  sanitizeDisplayText,
} from "./tool-rendering";

const GREP_CONFIG: ListResultConfig = {
  emptyMessage: "No matches found",
  singularLabel: "line",
  pluralLabel: "lines",
  moreLabel: "more lines",
  details: {
    limitKey: "matchLimitReached",
  },
  preprocess: (text) => {
    const body = text.includes("\n\n[")
      ? text.slice(0, text.lastIndexOf("\n\n["))
      : text;
    return body.split("\n").filter((f) => f.length > 0);
  },
};

export function patchGrepTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createGrepTool);

  return registerPatchedTool({
    pi,
    tool,
    name: "grep",
    label: "grep",
    promptSnippet: TOOL_PROMPTS.grep.promptSnippet,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      const renderArgs = args as GrepToolInput;
      const title = theme.fg("toolTitle", theme.bold("Grep "));
      const glob = renderArgs.glob
        ? theme.fg("muted", ` ${sanitizeDisplayText(renderArgs.glob)}`)
        : "";
      const context = renderArgs.context
        ? theme.fg("muted", ` ±${renderArgs.context}`)
        : "";
      const limit = renderArgs.limit
        ? theme.fg("muted", ` (limit ${renderArgs.limit})`)
        : "";
      const pathPrefix = renderArgs.path ? " in " : "";

      // Overhead = everything except pattern and the raw path string
      const overhead = visibleWidth(
        prefix + title + pathPrefix + glob + context + limit,
      );

      const MIN_PATTERN = 4; // "..." + 1
      const MIN_PATH = 4;
      const remaining = Math.max(0, MAX_CALL_WIDTH() - overhead);

      let patternBudget = remaining;
      let pathBudget = 0;

      if (renderArgs.path) {
        pathBudget = Math.max(
          MIN_PATH,
          Math.floor((remaining - MIN_PATTERN) / 2),
        );
        patternBudget = Math.max(MIN_PATTERN, remaining - pathBudget);
      }

      const rawPattern =
        typeof renderArgs.pattern === "string"
          ? sanitizeDisplayText(renderArgs.pattern)
          : "...";
      const patternDisplay =
        visibleWidth(rawPattern) > patternBudget
          ? truncateToWidth(rawPattern, patternBudget, "...")
          : rawPattern;

      const pattern = theme.fg("success", patternDisplay);
      const pathDisplay = renderArgs.path
        ? `${pathPrefix}${renderPath(renderArgs.path, theme, toolCtx.cwd, pathBudget)}`
        : "";

      const content =
        prefix + title + pattern + pathDisplay + glob + context + limit;
      text.setText(content);
      return text;
    },
    renderResult: buildRenderResult(
      (result, state, options, theme) =>
        formatListResult(result, state, options, theme, GREP_CONFIG),
      (details) => {
        const d = details as GrepToolDetails | undefined;
        return d?.truncation?.truncated === true || d?.linesTruncated === true;
      },
    ),
  });
}
