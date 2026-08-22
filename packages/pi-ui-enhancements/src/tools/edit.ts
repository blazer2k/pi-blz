import {
  createEditToolDefinition,
  renderDiff,
  Theme,
  type EditToolDetails,
  type EditToolInput,
  type ExtensionAPI,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";
import type { Handle } from "../types";
import {
  buildHint,
  buildRenderResult,
  buildResultStatusParts,
  extractTextContent,
  formatSimpleErrorResult,
  formatTreeLine,
  getCallRenderParts,
  MAX_CALL_WIDTH,
  renderPath,
  type BaseRenderState,
} from "./tool-rendering";

export function parseDiffStats(diff: string): {
  added: number;
  removed: number;
} {
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

  const metadataParts = buildResultStatusParts(state, theme);
  const diff = (result.details as EditToolDetails | undefined)?.diff;
  if (!diff) {
    metadataParts.push(theme.fg("muted", "no diff"));
    return (
      theme.fg("dim", "╰─ ") + metadataParts.join(theme.fg("muted", " • "))
    );
  }

  const { added, removed } = parseDiffStats(diff);
  const parts: string[] = [];
  if (added) {
    parts.push(theme.fg("toolDiffAdded", `+${added}`));
  }
  if (removed) {
    parts.push(theme.fg("toolDiffRemoved", `-${removed}`));
  }

  const stats = parts.join(" ");
  if (stats) metadataParts.push(stats);
  const metadata = metadataParts.join(theme.fg("muted", " • "));
  const hint = buildHint(theme);

  if (!options.expanded) {
    return theme.fg("dim", "╰─ ") + metadata + hint;
  }

  const rendered = renderDiff(diff);
  const lines = rendered.split("\n");
  const renderedLines = lines.map((line, index) => {
    const prefix = index === lines.length - 1 ? "╰─ " : "│  ";
    return formatTreeLine(line, {
      theme,
      prefix,
      width: MAX_CALL_WIDTH() - 1,
      mode: "preserve",
    }).text;
  });
  if (metadata) {
    renderedLines.unshift(theme.fg("dim", "├─ ") + metadata);
  }
  return renderedLines.join("\n");
}

export function patchEditTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createEditToolDefinition);

  return registerPatchedTool({
    pi,
    tool,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const renderArgs = args as EditToolInput;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      let content = prefix;

      const title = theme.fg("toolTitle", theme.bold("Edit "));
      const pathWidth = Math.max(
        1,
        MAX_CALL_WIDTH() - visibleWidth(content + title),
      );
      content += title;
      content += renderPath(renderArgs.path, theme, toolCtx.cwd, pathWidth);

      text.setText(
        truncateToWidth(content, MAX_CALL_WIDTH(), theme.fg("accent", "...")),
      );
      return text;
    },
    renderResult: buildRenderResult(formatEditResult),
  });
}
