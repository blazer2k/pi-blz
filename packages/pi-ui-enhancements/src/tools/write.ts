import {
  createWriteToolDefinition,
  Theme,
  highlightCode,
  getLanguageFromPath,
  type ExtensionAPI,
  type ToolRenderResultOptions,
  type WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatSimpleErrorResult } from "./rendering/results";
import {
  buildResultStatusParts,
  buildToolExpansionHint,
  getMaxCallWidth,
  getMaxExpandedEntries,
  invalidateIfChanged,
  updateResultState,
} from "./rendering/state";
import { countLines, extractTextContent, renderPath } from "./rendering/text";
import {
  formatTreeLine,
  getCallRenderParts,
  getResultText,
  setExpandableCallText,
} from "./rendering/tree";
import type { BaseRenderState } from "./rendering/types";
import type { Handle } from "../shared/handle";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";

function formatWriteResult(
  result: { content: Array<{ type: string; text?: string }> },
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  args: WriteToolInput,
): string {
  const textContent = extractTextContent(result);

  if (state.isError) {
    return formatSimpleErrorResult(textContent, state, options, theme);
  }

  const lines = countLines(args.content);
  const hint = buildToolExpansionHint(theme, state, options, lines > 0);
  const summary = `${lines} ${lines === 1 ? "line" : "lines"}`;
  const metadataParts = buildResultStatusParts(state, theme);
  metadataParts.push(theme.fg("muted", summary));
  const metadata = metadataParts.join(theme.fg("muted", " • "));

  if (lines === 0) {
    return theme.fg("dim", "╰─ ") + metadata + hint;
  }

  if (options.expanded) {
    const lang = args.path ? getLanguageFromPath(args.path) : undefined;
    const maxPreviewLines = getMaxExpandedEntries();
    const previewLineCount = Number.isFinite(maxPreviewLines)
      ? maxPreviewLines
      : Infinity;
    const previewText = args.content
      .split("\n")
      .slice(0, previewLineCount)
      .join("\n");
    const previewBase = previewText.endsWith("\n")
      ? previewText.slice(0, -1)
      : previewText;
    // highlightCode falls back to pi's global theme proxy when no language
    // matches, so color unhighlighted lines with the injected theme instead.
    const highlightedLines = lang
      ? highlightCode(previewBase, lang)
      : previewBase.split("\n").map((line) => theme.fg("mdCodeBlock", line));
    const remainingLines = Math.max(0, lines - previewLineCount);

    const renderedLines = highlightedLines.map((line, index) => {
      const isLastLine = index === highlightedLines.length - 1;
      const prefix = remainingLines === 0 && isLastLine ? "╰─ " : "│  ";
      return formatTreeLine(line, {
        theme,
        prefix,
        width: getMaxCallWidth() - 1,
        mode: "preserve",
      }).text;
    });

    if (remainingLines > 0) {
      renderedLines.push(
        theme.fg("dim", "╰─ ") +
          theme.fg("muted", `${remainingLines} more lines`),
      );
    }

    renderedLines.unshift(theme.fg("dim", "├─ ") + metadata + hint);

    return renderedLines.join("\n");
  }

  return theme.fg("dim", "╰─ ") + metadata + hint;
}

export function patchWriteTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createWriteToolDefinition);

  return registerPatchedTool({
    pi,
    tool,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const renderArgs = args as WriteToolInput;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      const title = theme.fg("toolTitle", theme.bold("Write "));
      const fullPath = renderPath(renderArgs.path, theme, toolCtx.cwd);
      const pathWidth = Math.max(
        1,
        getMaxCallWidth() - visibleWidth(prefix + title),
      );
      let collapsedText =
        prefix +
        title +
        renderPath(renderArgs.path, theme, toolCtx.cwd, pathWidth);
      let fullText = prefix + title + fullPath;

      setExpandableCallText(text, state, {
        expanded: toolCtx.expanded,
        collapsedText,
        fullText,
        compactIsLossy: visibleWidth(fullPath) > pathWidth,
        ellipsis: theme.fg("accent", "..."),
      });
      if (toolCtx.isPartial && typeof renderArgs.content === "string") {
        const partialResult = formatWriteResult(
          { content: [] },
          state,
          { expanded: toolCtx.expanded, isPartial: toolCtx.isPartial },
          theme,
          renderArgs,
        );
        collapsedText += `\n${partialResult}`;
        fullText += `\n${partialResult}`;
        text.setText(toolCtx.expanded ? fullText : collapsedText);
      }
      return text;
    },
    renderResult(result, options, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const text = getResultText(state, options, toolCtx.lastComponent);

      const details = result.details as
        | { truncation?: { truncated?: boolean } }
        | undefined;
      const changed = updateResultState(state, {
        truncated: details?.truncation?.truncated === true,
        isError: toolCtx.isError,
      });

      invalidateIfChanged(changed, toolCtx.invalidate);

      const writeArgs = toolCtx.args as WriteToolInput;
      text.setText(formatWriteResult(result, state, options, theme, writeArgs));

      return text;
    },
  });
}
