import type {
  ExtensionAPI,
  LsToolInput,
} from "@earendil-works/pi-coding-agent";
import { createLsToolDefinition } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";
import { splitNativeListOutput } from "./list-rendering";
import { buildRenderResult, formatListResult } from "./rendering/results";
import { getMaxCallWidth } from "./rendering/state";
import { renderPath } from "./rendering/text";
import { getCallRenderParts, setExpandableCallText } from "./rendering/tree";
import type { BaseRenderState, ListResultConfig } from "./rendering/types";

const LS_CONFIG: ListResultConfig = {
  emptyMessage: "(empty directory)",
  singularLabel: "entry",
  pluralLabel: "entries",
  moreLabel: "more entries",
  preprocess: splitNativeListOutput,
};

export function patchLsTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createLsToolDefinition);

  return registerPatchedTool({
    pi,
    tool,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      const renderArgs = args as LsToolInput;
      const title = theme.fg("toolTitle", theme.bold("Ls "));
      const limit = renderArgs.limit
        ? theme.fg("dim", ` (limit ${renderArgs.limit})`)
        : "";
      const path = renderArgs.path || ".";
      const pathWidth = Math.max(
        1,
        getMaxCallWidth() - visibleWidth(prefix + title + limit),
      );
      const collapsedText =
        prefix +
        title +
        renderPath(path, theme, toolCtx.cwd, pathWidth) +
        limit;
      const fullText =
        prefix + title + renderPath(path, theme, toolCtx.cwd) + limit;

      setExpandableCallText(text, state, {
        expanded: toolCtx.expanded,
        collapsedText,
        fullText,
        ellipsis: theme.fg("accent", "..."),
      });
      return text;
    },
    renderResult: buildRenderResult((result, state, options, theme) =>
      formatListResult(result, state, options, theme, LS_CONFIG),
    ),
  });
}
