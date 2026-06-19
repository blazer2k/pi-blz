import {
  createWriteTool,
  keyHint,
  Theme,
  highlightCode,
  getLanguageFromPath,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolRenderResultOptions,
  type WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  buildHint,
  clearBlinkTimers,
  countLines,
  getResultSymbolColor,
  getStatusColor,
  getStatusSymbol,
  MAX_CALL_WIDTH,
  renderPath,
  updateBlinkTimer,
  type BaseRenderState,
} from "./tool-rendering";
import type { Handle } from "../types";

function formatWriteResult(
  result: { content: Array<{ type: string; text?: string }> },
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  args: WriteToolInput,
): string {
  const textContent = result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text ?? "")
    .join("\n");

  const hint = buildHint(theme);

  if (state.isError) {
    const output = textContent.endsWith("\n")
      ? textContent.slice(0, -1)
      : textContent;
    const lines = output.split("\n");
    let end = lines.length;
    while (end > 0 && lines[end - 1] === "") end--;
    const trimmed = lines.slice(0, end);

    if (options.expanded) {
      return theme.fg("error", trimmed.join("\n"));
    }

    const maxLineWidth = Math.floor(
      (process.stdout.columns ??
        Number(process.env.COLUMNS) ??
        MAX_CALL_WIDTH) / 2,
    );
    const joined = trimmed.join("\n");

    if (trimmed.length === 1 && visibleWidth(joined) <= maxLineWidth) {
      return (
        theme.fg(getResultSymbolColor(state), "└─ ") + theme.fg("error", joined)
      );
    }

    const truncated = joined.slice(0, maxLineWidth - 3);
    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("error", truncated + "...") +
      theme.fg("muted", " (expand for details)")
    );
  }

  const lines = countLines(args.content);
  const summary = `${lines} ${lines === 1 ? "line" : "lines"}`;

  if (options.expanded) {
    const lang = getLanguageFromPath(args.path);

    let expanded = "";

    const previewLines = args.content.split("\n").slice(0, 20);
    expanded += highlightCode(previewLines.join("\n"), lang).join("\n");
    if (lines > 20) {
      expanded += "\n" + theme.fg("muted", `... ${lines - 20} more lines`);
    }
    return expanded;
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

  pi.registerTool({
    name: "write",
    label: "write",
    description: tool.description,
    promptSnippet: "Create or overwrite files",
    promptGuidelines: ["Use write only for new files or complete rewrites."],
    parameters: tool.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, toolCtx) {
      const text =
        (toolCtx.lastComponent as Text | undefined) ?? new Text("", 1, 0);
      const state = toolCtx.state as BaseRenderState;

      const isDone =
        state.hasResult || (!toolCtx.executionStarted && !toolCtx.isPartial);

      updateBlinkTimer(state, !isDone, toolCtx.invalidate);

      let callLine = theme.fg(
        getStatusColor(isDone, state),
        `${getStatusSymbol(isDone)} `,
      );

      callLine += theme.fg("toolTitle", theme.bold("Write "));
      callLine += renderPath(args.path, theme, toolCtx.cwd);

      let content = truncateToWidth(callLine, MAX_CALL_WIDTH);
      if (toolCtx.isPartial && typeof args.content === "string") {
        content +=
          "\n" +
          formatWriteResult(
            { content: [] },
            state,
            { expanded: toolCtx.expanded, isPartial: toolCtx.isPartial },
            theme,
            args,
          )
            .split("\n")
            .map((l) => `  ${l}`)
            .join("\n");
      }

      text.setText(content);
      return text;
    },
    renderResult(result, options, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const paddingX = options.expanded ? 3 : 1;
      const text =
        state.expanded !== options.expanded
          ? new Text("", paddingX, 0)
          : ((toolCtx.lastComponent as Text | undefined) ??
            new Text("", paddingX, 0));
      state.expanded = options.expanded;

      const nextIsError = toolCtx.isError;
      const changed = state.isError !== nextIsError;
      state.isError = nextIsError;
      state.hasResult = true;

      const writeArgs = toolCtx.args as WriteToolInput;
      text.setText(formatWriteResult(result, state, options, theme, writeArgs));

      if (changed) {
        queueMicrotask(() => toolCtx.invalidate());
      }

      return text;
    },
  });

  return {
    dispose() {
      clearBlinkTimers();
    },
  };
}
