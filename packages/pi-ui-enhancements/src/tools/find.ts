import type {
  ExtensionAPI,
  FindToolInput,
} from "@earendil-works/pi-coding-agent";
import { createFindToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Handle } from "../types";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";
import { buildPatternPathCall, splitNativeListOutput } from "./list-rendering";
import { buildRenderResult, formatListResult } from "./rendering/results";
import { getCallRenderParts, setExpandableCallText } from "./rendering/tree";
import type { BaseRenderState, ListResultConfig } from "./rendering/types";

const FIND_CONFIG: ListResultConfig = {
  emptyMessage: "No files found matching pattern",
  singularLabel: "file",
  pluralLabel: "files",
  moreLabel: "more files",
  preprocess: splitNativeListOutput,
};

export function patchFindTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createFindToolDefinition);

  return registerPatchedTool({
    pi,
    tool,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      const renderArgs = args as FindToolInput;
      const title = theme.fg("toolTitle", theme.bold("Find "));
      const limit = renderArgs.limit
        ? theme.fg("dim", ` (limit ${renderArgs.limit})`)
        : "";
      const call = buildPatternPathCall({
        prefix,
        title,
        pattern: renderArgs.pattern,
        path: renderArgs.path,
        suffix: limit,
        cwd: toolCtx.cwd,
        theme,
      });

      setExpandableCallText(text, state, {
        expanded: toolCtx.expanded,
        ...call,
        ellipsis: theme.fg("accent", "..."),
      });
      return text;
    },
    renderResult: buildRenderResult((result, state, options, theme) =>
      formatListResult(result, state, options, theme, FIND_CONFIG),
    ),
  });
}
