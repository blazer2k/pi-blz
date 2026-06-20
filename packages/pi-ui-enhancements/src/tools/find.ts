import type {
  ExtensionAPI,
  ExtensionContext,
  FindToolDetails,
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
  getResultText,
  invalidateIfChanged,
  renderPath,
  updateResultState,
} from "./tool-rendering";

const FIND_CONFIG: ListResultConfig = {
  emptyMessage: "(no matches found)",
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

      let content = prefix;

      const renderArgs = args as FindToolInput;
      const title = theme.fg("toolTitle", theme.bold("Find "));
      const pattern = theme.fg("success", renderArgs.pattern);
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
                visibleWidth(content + title + pattern + pathPrefix + limit),
            ),
          )}`
        : "";

      content += title;
      content += pattern;
      content += pathDisplay;
      content += limit;

      text.setText(
        truncateToWidth(content, MAX_CALL_WIDTH, theme.fg("accent", "...")),
      );
      return text;
    },
    renderResult: buildRenderResult((result, state, options, theme) =>
      formatListResult(result, state, options, theme, FIND_CONFIG),
    ),
  });
}
