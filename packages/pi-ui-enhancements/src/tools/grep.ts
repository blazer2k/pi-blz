import type {
  ExtensionAPI,
  ExtensionContext,
  GrepToolDetails,
  GrepToolInput,
} from "@earendil-works/pi-coding-agent";
import { createGrepTool } from "@earendil-works/pi-coding-agent";
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
  getResultText,
  invalidateIfChanged,
  renderPath,
  updateResultState,
} from "./tool-rendering";

const GREP_CONFIG: ListResultConfig = {
  emptyMessage: "(no matches found)",
  singularLabel: "line",
  pluralLabel: "lines",
  moreLabel: "more lines",
  details: {
    limitKey: "matchLimitReached",
    extraTruncated: (d: GrepToolDetails) => d.linesTruncated === true,
  },
  preprocess: (text) => {
    const body = text.includes("\n\n[")
      ? text.slice(0, text.lastIndexOf("\n\n["))
      : text;
    return body.split("\n").filter((f) => f.length > 0);
  },
};

export function patchGrepTool(pi: ExtensionAPI, ctx: ExtensionContext): Handle {
  const tool = createGrepTool(ctx.cwd);

  return registerPatchedTool({
    pi,
    tool,
    name: "grep",
    label: "grep",
    promptSnippet: TOOL_PROMPTS.grep.promptSnippet,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      let content = prefix;

      const renderArgs = args as GrepToolInput;
      const title = theme.fg("toolTitle", theme.bold("Grep "));
      const pattern = theme.fg("success", renderArgs.pattern);
      const glob = renderArgs.glob
        ? theme.fg("muted", ` ${renderArgs.glob}`)
        : "";
      const context = renderArgs.context
        ? theme.fg("muted", ` ±${renderArgs.context}`)
        : "";
      const limit = renderArgs.limit
        ? theme.fg("muted", ` (limit ${renderArgs.limit})`)
        : "";
      const pathPrefix = renderArgs.path ? " in " : "";
      const pathDisplay = renderArgs.path
        ? `${pathPrefix}${renderPath(
            renderArgs.path,
            theme,
            toolCtx.cwd,
            Math.max(
              1,
              MAX_CALL_WIDTH -
                visibleWidth(
                  content +
                    title +
                    pattern +
                    pathPrefix +
                    glob +
                    context +
                    limit,
                ),
            ),
          )}`
        : "";

      content += title;
      content += pattern;
      content += pathDisplay;
      content += glob;
      content += context;
      content += limit;

      text.setText(
        truncateToWidth(content, MAX_CALL_WIDTH, theme.fg("accent", "...")),
      );
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
