import type {
  ExtensionAPI,
  ExtensionContext,
  ToolRenderResultOptions,
  Theme,
  BashToolDetails,
} from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
import { TOOL_PROMPTS } from "./tool-prompts";
import { registerPatchedTool } from "./tool-registration";
import {
  type BaseRenderState,
  MAX_CALL_WIDTH,
  buildHint,
  countLines,
  extractTextContent,
  formatErrorBody,
  formatTreeLine,
  getCallRenderParts,
  getResultSymbolColor,
  getResultText,
  invalidateIfChanged,
  normalizeOutput,
  registerToolTimer,
  unregisterToolTimer,
  updateResultState,
} from "./tool-rendering";

type BashToolInput = Parameters<
  ReturnType<typeof createBashTool>["execute"]
>[1];

type BashRenderState = BaseRenderState & {
  startedAt?: number;
  endedAt?: number;
  durationTimer?: ReturnType<typeof setInterval>;
  callTruncated?: boolean;
};

type BashDetailsWithTiming = BashToolDetails & {
  durationMs?: number;
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function getOutputWidth(): number {
  // Keep rendered output within the same fixed-width budget as call headers.
  return Math.max(1, MAX_CALL_WIDTH - 6);
}

function buildBashMetadataParts(
  args: {
    durationSummary?: string;
    remainingLines?: number;
    callTruncated?: boolean;
    lineTruncated?: boolean;
    toolTruncated?: boolean;
    expanded?: boolean;
  },
  theme: Theme,
): { parts: string[]; needsHint: boolean } {
  const parts: string[] = [];
  let needsHint = false;

  if (args.durationSummary) {
    parts.push(theme.fg("muted", args.durationSummary));
  }
  if ((args.remainingLines ?? 0) > 0) {
    const remainingLines = args.remainingLines ?? 0;
    parts.push(
      theme.fg(
        "muted",
        `${remainingLines} more ${remainingLines === 1 ? "line" : "lines"}`,
      ),
    );
    needsHint = true;
  }
  if (args.callTruncated && !args.expanded) {
    needsHint = true;
  }
  if (args.lineTruncated) {
    needsHint = true;
  }
  if (args.toolTruncated) {
    parts.push(theme.fg("warning", "truncated"));
  }

  return { parts, needsHint };
}

function formatOutputLines(
  text: string,
  theme: Theme,
  state: BashRenderState,
  color: "toolOutput" | "error" = "toolOutput",
  maxLineWidth?: number,
  closeLastLine = false,
): { text: string; truncated: boolean } {
  const output = normalizeOutput(text);
  if (!output) return { text: "", truncated: false };

  let truncated = false;
  const lines = output.split("\n");
  const renderedLines = lines.map((line, index) => {
    const prefix = closeLastLine && index === lines.length - 1 ? "└─ " : "│  ";
    const rendered = formatTreeLine(line, {
      theme,
      state,
      prefix,
      width: (maxLineWidth ?? getOutputWidth()) + 3,
      mode: maxLineWidth === undefined ? "preserve" : "truncate",
      color,
    });
    truncated ||= rendered.truncated;
    return rendered.text;
  });

  return { text: renderedLines.join("\n"), truncated };
}

function formatBashResult(
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  state: BashRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  const details = result.details as BashDetailsWithTiming | undefined;
  const textContent = extractTextContent(result);

  const hint = buildHint(theme);
  const elapsedMs =
    details?.durationMs ??
    (state.startedAt === undefined
      ? undefined
      : (state.endedAt ?? Date.now()) - state.startedAt);
  const durationSummary =
    elapsedMs === undefined
      ? undefined
      : `${options.isPartial ? "elapsed" : "took"} ${formatDuration(elapsedMs)}`;

  if (state.isError) {
    const errorBody = formatErrorBody(
      textContent,
      options,
      theme.fg("error", "..."),
    );

    if (options.expanded) {
      const summary = durationSummary ? `${durationSummary}, error` : "error";
      const outputLines = formatOutputLines(
        errorBody.text,
        theme,
        state,
        "error",
        undefined,
        true,
      );
      return [
        theme.fg(
          getResultSymbolColor(state),
          outputLines.text ? "├─ " : "└─ ",
        ) + theme.fg("error", summary),
        outputLines.text,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    }

    const prefix = durationSummary ? `${durationSummary}, ` : "";
    const suffix = errorBody.truncated ? hint : "";
    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("error", `${prefix}${errorBody.text}`) +
      suffix
    );
  }

  const lineCount = countLines(textContent);
  const showExpanded = options.expanded && lineCount > 1;
  const visibleLineCount = showExpanded ? lineCount : Math.min(lineCount, 5);
  const remainingLines = Math.max(0, lineCount - visibleLineCount);

  const output = showExpanded
    ? normalizeOutput(textContent)
    : normalizeOutput(textContent).split("\n").slice(-5).join("\n");
  const outputLines = formatOutputLines(
    output,
    theme,
    state,
    "toolOutput",
    showExpanded ? undefined : getOutputWidth(),
    true,
  );

  const { parts, needsHint } = buildBashMetadataParts(
    {
      durationSummary,
      remainingLines,
      callTruncated: state.callTruncated,
      lineTruncated: outputLines.truncated,
      toolTruncated: details?.truncation?.truncated === true,
      expanded: options.expanded,
    },
    theme,
  );

  const summary =
    parts.length > 0
      ? parts.join(theme.fg("muted", ", ")) + (needsHint ? hint : "")
      : theme.fg("muted", "output");

  if (lineCount <= 1) {
    const inlineOutput = normalizeOutput(textContent);
    const maxLineWidth = getOutputWidth();
    const shouldTruncate =
      !options.expanded && visibleWidth(inlineOutput) > maxLineWidth;
    const renderedOutput = shouldTruncate
      ? truncateToWidth(
          inlineOutput,
          maxLineWidth,
          theme.fg("toolOutput", "..."),
        )
      : inlineOutput;
    const { parts: metadataParts, needsHint: metadataNeedsHint } =
      buildBashMetadataParts(
        {
          durationSummary,
          callTruncated: state.callTruncated,
          lineTruncated: shouldTruncate,
          toolTruncated: details?.truncation?.truncated === true,
          expanded: options.expanded,
        },
        theme,
      );

    const metadataSummary =
      metadataParts.length > 0
        ? metadataParts.join(theme.fg("muted", ", ")) +
          (metadataNeedsHint ? hint : "")
        : "";

    if (metadataNeedsHint || (options.expanded && renderedOutput && shouldTruncate)) {
      const outputLine = formatTreeLine(renderedOutput, {
        theme,
        state,
        prefix: metadataSummary ? "└─ " : "└─ ",
        width: getOutputWidth() + 3,
        mode: options.expanded ? "preserve" : "truncate",
        color: "toolOutput",
      });
      return [
        metadataSummary
          ? theme.fg(getResultSymbolColor(state), "├─ ") + metadataSummary
          : undefined,
        outputLine.text,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    }

    const inlineParts = [metadataSummary, theme.fg("toolOutput", renderedOutput)]
      .filter(Boolean)
      .join(theme.fg("muted", ", "));

    return theme.fg(getResultSymbolColor(state), "└─ ") + (inlineParts || summary);
  }

  return [
    theme.fg(getResultSymbolColor(state), outputLines.text ? "├─ " : "└─ ") +
      summary,
    outputLines.text,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function patchBashTool(pi: ExtensionAPI, ctx: ExtensionContext): Handle {
  const tool = createBashTool(ctx.cwd);

  return registerPatchedTool({
    pi,
    tool,
    name: "bash",
    label: "bash",
    promptSnippet: TOOL_PROMPTS.bash.promptSnippet,
    async execute(toolCallId, params, signal, onUpdate) {
      const startedAt = Date.now();
      const result = await tool.execute(
        toolCallId,
        params as BashToolInput,
        signal,
        onUpdate,
      );
      const details = (result.details ?? {}) as BashDetailsWithTiming;

      return {
        ...result,
        details: {
          ...details,
          durationMs: Date.now() - startedAt,
        },
      };
    },
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BashRenderState;
      const renderArgs = args as BashToolInput;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      if (toolCtx.executionStarted && state.startedAt === undefined) {
        state.startedAt = Date.now();
        state.endedAt = undefined;
      }

      let content = prefix;

      const commandPreview = toolCtx.expanded
        ? renderArgs.command
        : renderArgs.command.replace(/\s+/g, " ").trim();
      const commandDisplay =
        theme.fg("dim", "$ ") +
        theme.bold(theme.fg("accent", commandPreview));

      const timeoutSuffix = renderArgs.timeout
        ? theme.fg("muted", ` (timeout ${renderArgs.timeout}s)`)
        : "";

      content += theme.fg("toolTitle", theme.bold("Bash "));
      content += commandDisplay;
      content += timeoutSuffix;

      const shouldTruncate =
        !toolCtx.expanded && visibleWidth(content) > MAX_CALL_WIDTH;
      state.callTruncated = shouldTruncate;
      text.setText(
        shouldTruncate
          ? truncateToWidth(content, MAX_CALL_WIDTH, theme.fg("accent", "..."))
          : content,
      );
      return text;
    },
    renderResult(result, options, theme, toolCtx) {
      const state = toolCtx.state as BashRenderState;
      const text = getResultText(state, options, toolCtx.lastComponent);

      const details = result.details as BashToolDetails | undefined;

      if (
        state.startedAt !== undefined &&
        options.isPartial &&
        !state.durationTimer
      ) {
        state.durationTimer = setInterval(() => toolCtx.invalidate(), 1000);
        registerToolTimer(state.durationTimer);
      }

      if (!options.isPartial || toolCtx.isError) {
        state.endedAt ??= Date.now();
        if (state.durationTimer) {
          clearInterval(state.durationTimer);
          unregisterToolTimer(state.durationTimer);
          state.durationTimer = undefined;
        }
      }

      const changed = updateResultState(state, {
        truncated: details?.truncation?.truncated === true,
        isError: toolCtx.isError,
      });

      invalidateIfChanged(changed, toolCtx.invalidate);
      text.setText(formatBashResult(result, state, options, theme));

      return text;
    },
  });
}
