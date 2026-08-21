import {
  createWriteToolDefinition,
  Theme,
  highlightCode,
  getLanguageFromPath,
  type ExtensionAPI,
  type ToolRenderResultOptions,
  type WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  buildHint,
  buildResultStatusParts,
  countLines,
  extractTextContent,
  formatSimpleErrorResult,
  formatTreeLine,
  getCallRenderParts,
  getResultSymbolColor,
  getResultText,
  invalidateIfChanged,
  MAX_CALL_WIDTH,
  MAX_EXPANDED_ENTRIES,
  renderPath,
  updateResultState,
  type BaseRenderState,
} from "./tool-rendering";
import type { Handle } from "../types";
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

  const hint = buildHint(theme);

  if (state.isError) {
    return formatSimpleErrorResult(textContent, state, options, theme);
  }

  const lines = countLines(args.content);
  const summary = `${lines} ${lines === 1 ? "line" : "lines"}`;
  const metadataParts = buildResultStatusParts(state, theme);
  metadataParts.push(theme.fg("toolOutput", summary));
  const metadata = metadataParts.join(theme.fg("toolOutput", ", "));

  if (options.expanded) {
    const lang = args.path ? getLanguageFromPath(args.path) : undefined;
    const maxPreviewLines = MAX_EXPANDED_ENTRIES();
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
      const prefix = remainingLines === 0 && isLastLine ? "└─ " : "│  ";
      return formatTreeLine(line, {
        theme,
        state,
        prefix,
        width: MAX_CALL_WIDTH() - 1,
        mode: "preserve",
      }).text;
    });

    if (remainingLines > 0) {
      renderedLines.push(
        theme.fg(getResultSymbolColor(state), "└─ ") +
          theme.fg("muted", `${remainingLines} more lines`),
      );
    }

    renderedLines.unshift(
      theme.fg(getResultSymbolColor(state), "├─ ") + metadata,
    );

    return renderedLines.join("\n");
  }

  return theme.fg(getResultSymbolColor(state), "└─ ") + metadata + hint;
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

      let callLine = prefix;

      const title = theme.fg("toolTitle", theme.bold("Write "));
      const pathWidth = Math.max(
        1,
        MAX_CALL_WIDTH() - visibleWidth(callLine + title),
      );
      callLine += title;
      callLine += renderPath(renderArgs.path, theme, toolCtx.cwd, pathWidth);

      let content = truncateToWidth(
        callLine,
        MAX_CALL_WIDTH(),
        theme.fg("accent", "..."),
      );
      if (toolCtx.isPartial && typeof renderArgs.content === "string") {
        content +=
          "\n" +
          formatWriteResult(
            { content: [] },
            state,
            { expanded: toolCtx.expanded, isPartial: toolCtx.isPartial },
            theme,
            renderArgs,
          );
      }

      text.setText(content);
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
