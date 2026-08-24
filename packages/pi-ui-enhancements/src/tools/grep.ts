import type {
  ExtensionAPI,
  GrepToolDetails,
  GrepToolInput,
} from "@earendil-works/pi-coding-agent";
import { createGrepToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Handle } from "../types";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";
import { buildPatternPathCall, splitNativeListOutput } from "./list-rendering";
import { buildRenderResult, formatListResult } from "./rendering/results";
import { sanitizeDisplayText } from "./rendering/text";
import { getCallRenderParts, setExpandableCallText } from "./rendering/tree";
import type { BaseRenderState, ListResultConfig } from "./rendering/types";

const GREP_CONFIG: ListResultConfig = {
  emptyMessage: "No matches found",
  singularLabel: "line",
  pluralLabel: "lines",
  moreLabel: "more lines",
  preprocess: splitNativeListOutput,
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
      const call = buildPatternPathCall({
        prefix,
        title,
        pattern: renderArgs.pattern,
        path: renderArgs.path,
        suffix: glob + context + limit,
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
