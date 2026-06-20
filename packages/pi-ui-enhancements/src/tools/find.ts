import type {
  ExtensionAPI,
  ExtensionContext,
  FindToolInput,
} from "@earendil-works/pi-coding-agent";
import { createFindTool } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
import { TOOL_PROMPTS } from "./tool-prompts";
import { registerPatchedTool } from "./tool-registration";
import {
  type BaseRenderState,
  type ListResultConfig,
  MAX_CALL_WIDTH,
  buildRenderResult,
  formatListResult,
  getCallRenderParts,
  renderPath,
} from "./tool-rendering";

const FIND_CONFIG: ListResultConfig = {
  emptyMessage: "No files found matching pattern",
  singularLabel: "file",
  pluralLabel: "files",
  moreLabel: "more files",
  details: { limitKey: "resultLimitReached" },
  preprocess: (text) => {
    const body = text.includes("\n\n[")
      ? text.slice(0, text.lastIndexOf("\n\n["))
      : text;
    return body.split("\n").filter((f) => f.length > 0);
  },
};

export function patchFindTool(pi: ExtensionAPI, ctx: ExtensionContext): Handle {
  const tool = createFindTool(ctx.cwd);

  return registerPatchedTool({
    pi,
    tool,
    name: "find",
    label: "find",
    promptSnippet: TOOL_PROMPTS.find.promptSnippet,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      const renderArgs = args as FindToolInput;
      const title = theme.fg("toolTitle", theme.bold("Find "));
      const limit = renderArgs.limit
        ? theme.fg("muted", ` (limit ${renderArgs.limit})`)
        : "";
      const pathPrefix = renderArgs.path ? " in " : "";

      // Overhead = everything except pattern and the raw path string
      const overhead = visibleWidth(prefix + title + pathPrefix + limit);

      const MIN_PATTERN = 4; // "..." + 1
      const MIN_PATH = 4;
      const remaining = Math.max(0, MAX_CALL_WIDTH - overhead);

      let patternBudget = remaining;
      let pathBudget = 0;

      if (renderArgs.path) {
        pathBudget = Math.max(
          MIN_PATH,
          Math.floor((remaining - MIN_PATTERN) / 2),
        );
        patternBudget = Math.max(MIN_PATTERN, remaining - pathBudget);
      }

      const rawPattern = renderArgs.pattern;
      const patternDisplay =
        visibleWidth(rawPattern) > patternBudget
          ? truncateToWidth(rawPattern, patternBudget, "...")
          : rawPattern;

      const pattern = theme.fg("success", patternDisplay);
      const pathDisplay = renderArgs.path
        ? `${pathPrefix}${renderPath(renderArgs.path, theme, toolCtx.cwd, pathBudget)}`
        : "";

      const content = prefix + title + pattern + pathDisplay + limit;
      text.setText(content);
      return text;
    },
    renderResult: buildRenderResult((result, state, options, theme) =>
      formatListResult(result, state, options, theme, FIND_CONFIG),
    ),
  });
}
