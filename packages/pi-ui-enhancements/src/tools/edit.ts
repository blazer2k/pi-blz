import {
  createEditTool,
  renderDiff,
  Theme,
  type EditToolDetails,
  type EditToolInput,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { registerPatchedTool } from "./tool-registration";
import type { Handle } from "../types";
import { TOOL_PROMPTS } from "./tool-prompts";
import {
  buildHint,
  buildRenderResult,
  extractTextContent,
  formatSimpleErrorResult,
  formatTreeLine,
  getCallRenderParts,
  getResultSymbolColor,
  MAX_CALL_WIDTH,
  renderPath,
  type BaseRenderState,
} from "./tool-rendering";

function parseDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed++;
    }
  }
  return { added, removed };
}

function formatEditResult(
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  if (state.isError) {
    return formatSimpleErrorResult(
      extractTextContent(result),
      state,
      options,
      theme,
    );
  }

  const diff = (result.details as EditToolDetails | undefined)?.diff;
  if (!diff) {
    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("toolOutput", "no diff")
    );
  }

  const { added, removed } = parseDiffStats(diff);
  const parts: string[] = [];
  if (added) {
    parts.push(theme.fg("success", `+${added}`));
  }
  if (removed) {
    parts.push(theme.fg("error", `-${removed}`));
  }

  const stats = parts.join(" ");
  const hint = buildHint(theme);

  if (!options.expanded) {
    return theme.fg(getResultSymbolColor(state), "└─ ") + stats + hint;
  }

  const rendered = renderDiff(diff);
  const lines = rendered.split("\n");
  return lines
    .map((line, index) => {
      const prefix = index === lines.length - 1 ? "└─ " : "│  ";
      return formatTreeLine(line, {
        theme,
        state,
        prefix,
        width: MAX_CALL_WIDTH - 1,
        mode: "preserve",
      }).text;
    })
    .join("\n");
}

export function patchEditTool(pi: ExtensionAPI, ctx: ExtensionContext): Handle {
  const tool = createEditTool(ctx.cwd);

  return registerPatchedTool({
    pi,
    tool,
    name: "edit",
    label: "edit",
    promptSnippet: TOOL_PROMPTS.edit.promptSnippet,
    promptGuidelines: [...TOOL_PROMPTS.edit.promptGuidelines],
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const renderArgs = args as EditToolInput;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      let content = prefix;

      const title = theme.fg("toolTitle", theme.bold("Edit "));
      const pathWidth = Math.max(
        1,
        MAX_CALL_WIDTH - visibleWidth(content + title),
      );
      content += title;
      content += renderPath(renderArgs.path, theme, toolCtx.cwd, pathWidth);

      text.setText(
        truncateToWidth(content, MAX_CALL_WIDTH, theme.fg("accent", "...")),
      );
      return text;
    },
    renderResult: buildRenderResult(formatEditResult),
  });
}
