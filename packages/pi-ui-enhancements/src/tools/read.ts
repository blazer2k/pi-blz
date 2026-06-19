import type {
  ExtensionAPI,
  ExtensionContext,
  ToolRenderResultOptions,
  ReadToolDetails,
  Theme,
  ReadToolInput,
} from "@earendil-works/pi-coding-agent";
import { createReadTool } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
import {
  type BaseRenderState,
  MAX_CALL_WIDTH,
  buildHint,
  clearBlinkTimers,
  countLines,
  getResultSymbolColor,
  getStatusColor,
  getStatusSymbol,
  renderPath,
  updateBlinkTimer,
} from "./tool-rendering";

function formatReadLineRange(
  args: ReadToolInput | undefined,
  theme: Theme,
): string {
  if (args?.offset === undefined && args?.limit === undefined) return "";
  const startLine = args.offset ?? 1;
  const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
  return theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
}

function formatReadResult(
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  const details = result.details as ReadToolDetails | undefined;
  const hasImage = result.content.some((c) => c.type === "image");
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
    while (end > 0 && lines[end - 1] === "") {
      end--;
    }
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
      hint
    );
  }

  const parts: string[] = [];
  if (textContent && !hasImage) {
    const lines = countLines(textContent);
    parts.push(`${lines} ${lines === 1 ? "line" : "lines"}`);
  }
  if (hasImage) {
    const match = textContent.match(/original\s+(\d+)x(\d+)/);
    if (match) {
      parts.push(`Image (${match[1]}x${match[2]})`);
    } else {
      parts.push("Image");
    }
  }
  if (details?.truncation?.truncated) {
    parts.push("truncated");
  }

  const summary = parts.length > 0 ? parts.join(", ") : "no content";

  return (
    theme.fg(getResultSymbolColor(state), "└─ ") +
    theme.fg("toolOutput", summary)
  );
}

export function patchReadTool(pi: ExtensionAPI, ctx: ExtensionContext): Handle {
  const tool = createReadTool(ctx.cwd);

  pi.registerTool({
    name: "read",
    label: "read",
    description: tool.description,
    promptSnippet: "Read file contents",
    promptGuidelines: ["Use read to examine files instead of cat or sed."],
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

      let content = theme.fg(
        getStatusColor(isDone, state),
        `${getStatusSymbol(isDone)} `,
      );

      const renderArgs = args as ReadToolInput;
      const pathDisplay = renderPath(renderArgs.path, theme, toolCtx.cwd);

      content += theme.fg("toolTitle", theme.bold("Read "));
      content += pathDisplay;
      content += formatReadLineRange(renderArgs, theme);

      text.setText(truncateToWidth(content, MAX_CALL_WIDTH));
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

      const details = result.details as ReadToolDetails | undefined;

      const nextHasResult = true;
      const nextTruncated = details?.truncation?.truncated === true;
      const nextIsError = toolCtx.isError;

      const changed =
        state.hasResult !== nextHasResult ||
        state.truncated !== nextTruncated ||
        state.isError !== nextIsError;

      state.hasResult = nextHasResult;
      state.truncated = nextTruncated;
      state.isError = nextIsError;

      text.setText(formatReadResult(result, state, options, theme));

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
