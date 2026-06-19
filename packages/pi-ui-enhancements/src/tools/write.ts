import {
  createWriteTool,
  Theme,
  highlightCode,
  getLanguageFromPath,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolRenderResultOptions,
  type WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  buildHint,
  countLines,
  extractTextContent,
  formatSimpleErrorResult,
  formatTreeLine,
  getCallRenderParts,
  getResultSymbolColor,
  getResultText,
  invalidateIfChanged,
  MAX_CALL_WIDTH,
  renderPath,
  updateResultState,
  type BaseRenderState,
} from "./tool-rendering";
import type { Handle } from "../types";
import { TOOL_PROMPTS } from "./tool-prompts";
import { registerPatchedTool } from "./tool-registration";

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

  if (options.expanded) {
    const lang = getLanguageFromPath(args.path);
    const previewText = args.content.split("\n").slice(0, 20).join("\n");
    const highlightedLines = highlightCode(
      previewText.endsWith("\n") ? previewText.slice(0, -1) : previewText,
      lang,
    );
    const remainingLines = Math.max(0, lines - 20);

    const renderedLines = highlightedLines.map((line, index) => {
      const isLastLine = index === highlightedLines.length - 1;
      const prefix = remainingLines === 0 && isLastLine ? "└─ " : "│  ";
      return formatTreeLine(line, {
        theme,
        state,
        prefix,
        width: MAX_CALL_WIDTH - 1,
        mode: "preserve",
      }).text;
    });

    if (remainingLines > 0) {
      renderedLines.push(
        theme.fg(getResultSymbolColor(state), "└─ ") +
          theme.fg("muted", `${remainingLines} more lines`),
      );
    }

    return renderedLines.join("\n");
  }

  return (
    theme.fg(getResultSymbolColor(state), "└─ ") +
    theme.fg("toolOutput", summary) +
    hint
  );
}

export function patchWriteTool(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Handle {
  const tool = createWriteTool(ctx.cwd);

  return registerPatchedTool({
    pi,
    tool,
    name: "write",
    label: "write",
    promptSnippet: TOOL_PROMPTS.write.promptSnippet,
    promptGuidelines: [...TOOL_PROMPTS.write.promptGuidelines],
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const renderArgs = args as WriteToolInput;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx, 0);

      let callLine = ` ${prefix}`;

      const title = theme.fg("toolTitle", theme.bold("Write "));
      const pathWidth = Math.max(
        1,
        MAX_CALL_WIDTH - visibleWidth(callLine + title),
      );
      callLine += title;
      callLine += renderPath(renderArgs.path, theme, toolCtx.cwd, pathWidth);

      let content = truncateToWidth(
        callLine,
        MAX_CALL_WIDTH,
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
          )
            .split("\n")
            .map((line) => ` ${line}`)
            .join("\n");
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
      const resultText = formatWriteResult(
        result,
        state,
        options,
        theme,
        writeArgs,
      );
      text.setText(resultText);

      return text;
    },
  });
}
