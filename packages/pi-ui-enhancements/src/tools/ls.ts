import type {
  ExtensionAPI,
  LsToolInput,
} from "@earendil-works/pi-coding-agent";
import { createLsToolDefinition } from "@earendil-works/pi-coding-agent";
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
} from "./tool-rendering";

const LS_CONFIG: ListResultConfig = {
  emptyMessage: "(empty directory)",
  singularLabel: "entry",
  pluralLabel: "entries",
  moreLabel: "more entries",
  preprocess: (text) => {
    const body = text.includes("\n\n[")
      ? text.slice(0, text.lastIndexOf("\n\n["))
      : text;
    return body.split("\n").filter((entry) => entry.length > 0);
  },
};

export function patchLsTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createLsToolDefinition);

  return registerPatchedTool({
    pi,
    tool,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      let content = prefix;

      const renderArgs = args as LsToolInput;
      const title = theme.fg("toolTitle", theme.bold("Ls "));
      const limit = renderArgs.limit
        ? theme.fg("dim", ` (limit ${renderArgs.limit})`)
        : "";
      const pathWidth = Math.max(
        1,
        MAX_CALL_WIDTH() - visibleWidth(content + title + limit),
      );
      const pathDisplay = renderPath(
        renderArgs.path || ".",
        theme,
        toolCtx.cwd,
        pathWidth,
      );

      content += title;
      content += pathDisplay;
      content += limit;

      text.setText(
        truncateToWidth(content, MAX_CALL_WIDTH(), theme.fg("accent", "...")),
      );
      return text;
    },
    renderResult: buildRenderResult((result, state, options, theme) =>
      formatListResult(result, state, options, theme, LS_CONFIG),
    ),
  });
}
