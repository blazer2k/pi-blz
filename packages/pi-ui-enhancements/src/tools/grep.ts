import type {
  ExtensionAPI,
  GrepToolDetails,
  GrepToolInput,
} from "@earendil-works/pi-coding-agent";
import { createGrepToolDefinition } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
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
  setExpandableCallText,
} from "./tool-rendering";

const GREP_CONFIG: ListResultConfig = {
  emptyMessage: "No matches found",
  singularLabel: "line",
  pluralLabel: "lines",
  moreLabel: "more lines",
  preprocess: (text) => {
    const body = text.includes("\n\n[")
      ? text.slice(0, text.lastIndexOf("\n\n["))
      : text;
    return body.split("\n").filter((f) => f.length > 0);
  },
};

export function patchGrepTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createGrepToolDefinition);

  return registerPatchedTool({
    pi,
    tool,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      const renderArgs = args as GrepToolInput;
      const title = theme.fg("toolTitle", theme.bold("Grep "));
      const glob = renderArgs.glob
        ? theme.fg("dim", ` ${sanitizeDisplayText(renderArgs.glob)}`)
        : "";
      const context = renderArgs.context
        ? theme.fg("dim", ` ±${renderArgs.context}`)
        : "";
      const limit = renderArgs.limit
        ? theme.fg("dim", ` (limit ${renderArgs.limit})`)
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
      const patternTruncated = visibleWidth(rawPattern) > patternBudget;
      const patternDisplay = patternTruncated
        ? truncateToWidth(rawPattern, patternBudget, "...")
        : rawPattern;
      const fullPath = renderArgs.path
        ? renderPath(renderArgs.path, theme, toolCtx.cwd)
        : "";
      const pathTruncated =
        renderArgs.path !== undefined && visibleWidth(fullPath) > pathBudget;
      const pattern = theme.fg("accent", patternDisplay);
      const pathDisplay = renderArgs.path
        ? `${pathPrefix}${renderPath(renderArgs.path, theme, toolCtx.cwd, pathBudget)}`
        : "";
      const collapsedText =
        prefix + title + pattern + pathDisplay + glob + context + limit;
      const fullText =
        prefix +
        title +
        theme.fg("accent", rawPattern) +
        (renderArgs.path ? `${pathPrefix}${fullPath}` : "") +
        glob +
        context +
        limit;

      setExpandableCallText(text, state, {
        expanded: toolCtx.expanded,
        collapsedText,
        fullText,
        compactIsLossy: patternTruncated || pathTruncated,
        ellipsis: theme.fg("accent", "..."),
      });
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
