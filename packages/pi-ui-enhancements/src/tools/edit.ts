import {
  createEditToolDefinition,
  renderDiff,
  Theme,
  type EditToolDetails,
  type EditToolInput,
  type ExtensionAPI,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";
import type { Handle } from "../types";
import {
  buildRenderResult,
  buildResultStatusParts,
  buildToolExpansionHint,
  extractTextContent,
  formatSimpleErrorResult,
  formatTreeLine,
  getCallRenderParts,
  getMaxCallWidth,
  renderPath,
  setExpandableCallText,
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
      theme.fg("dim", "╰─ ") +
      metadataParts.join(theme.fg("muted", " • ")) +
      buildToolExpansionHint(theme, state, options, false)
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
  const hint = buildToolExpansionHint(
    theme,
    state,
    options,
    true,
    metadata ? "suffix" : "standalone",
  );

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
      width: getMaxCallWidth() - 1,
      mode: "preserve",
    }).text;
  });
  if (metadata || hint) {
    renderedLines.unshift(theme.fg("dim", "├─ ") + metadata + hint);
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

      const title = theme.fg("toolTitle", theme.bold("Edit "));
      const fullPath = renderPath(renderArgs.path, theme, toolCtx.cwd);
      const pathWidth = Math.max(
        1,
        getMaxCallWidth() - visibleWidth(prefix + title),
      );
      const collapsedText =
        prefix +
        title +
        renderPath(renderArgs.path, theme, toolCtx.cwd, pathWidth);
      const fullText = prefix + title + fullPath;

      setExpandableCallText(text, state, {
        expanded: toolCtx.expanded,
        collapsedText,
        fullText,
        compactIsLossy: visibleWidth(fullPath) > pathWidth,
        ellipsis: theme.fg("accent", "..."),
      });
      return text;
    },
    renderResult: buildRenderResult(formatEditResult),
  });
}
