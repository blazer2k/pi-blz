import type {
  ExtensionAPI,
  ExtensionContext,
  ToolRenderResultOptions,
  Theme,
  BashToolDetails,
} from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
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
  updateBlinkTimer,
} from "./tool-rendering";

type BashRenderState = BaseRenderState & {
  startedAt?: number;
  endedAt?: number;
  durationTimer?: ReturnType<typeof setInterval>;
};

type BashDetailsWithTiming = BashToolDetails & {
  durationMs?: number;
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function normalizeOutput(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function getOutputWidth(): number {
  return Math.max(
    1,
    (process.stdout.columns ?? Number(process.env.COLUMNS) ?? MAX_CALL_WIDTH) -
      6,
  );
}

function formatOutputLines(
  text: string,
  theme: Theme,
  state: BashRenderState,
  color: "toolOutput" | "error" = "toolOutput",
  maxLineWidth?: number,
  closeLastLine = false,
): string {
  const output = normalizeOutput(text);
  if (!output) return "";

  const lines = output.split("\n");
  return lines
    .map((line, index) => {
      const renderedLine =
        maxLineWidth === undefined
          ? line
          : truncateToWidth(line, maxLineWidth, "...");
      const prefix =
        closeLastLine && index === lines.length - 1 ? "└─ " : "│  ";
      return (
        theme.fg(getResultSymbolColor(state), prefix) +
        theme.fg(color, renderedLine)
      );
    })
    .join("\n");
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
  const textContent = result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text ?? "")
    .join("\n");

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
    const output = normalizeOutput(textContent);
    const lines = output.split("\n");
    let end = lines.length;
    while (end > 0 && lines[end - 1] === "") {
      end--;
    }
    const trimmed = lines.slice(0, end);
    const joined = trimmed.join("\n");

    if (options.expanded) {
      const summary = durationSummary ? `${durationSummary}, error` : "error";
      const outputLines = formatOutputLines(
        joined,
        theme,
        state,
        "error",
        undefined,
        true,
      );
      return [
        theme.fg(getResultSymbolColor(state), outputLines ? "├─ " : "└─ ") +
          theme.fg("error", summary),
        outputLines,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    }

    const maxLineWidth = Math.floor(
      (process.stdout.columns ??
        Number(process.env.COLUMNS) ??
        MAX_CALL_WIDTH) / 2,
    );

    if (trimmed.length === 1 && visibleWidth(joined) <= maxLineWidth) {
      const prefix = durationSummary ? `${durationSummary}, ` : "";
      return (
        theme.fg(getResultSymbolColor(state), "└─ ") +
        theme.fg("error", `${prefix}${joined}`)
      );
    }

    const truncated = joined.slice(0, maxLineWidth - 3);
    const prefix = durationSummary ? `${durationSummary}, ` : "";
    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("error", `${prefix}${truncated}...`) +
      hint
    );
  }

  const lineCount = countLines(textContent);
  const showExpanded = options.expanded && lineCount > 1;
  const visibleLineCount = showExpanded ? lineCount : Math.min(lineCount, 5);
  const remainingLines = Math.max(0, lineCount - visibleLineCount);

  const parts: string[] = [];
  if (durationSummary) {
    parts.push(theme.fg("muted", durationSummary));
  }
  if (remainingLines > 0) {
    parts.push(
      theme.fg(
        "muted",
        `${remainingLines} more ${remainingLines === 1 ? "line" : "lines"} `,
      ) + hint,
    );
  }
  if (details?.truncation?.truncated) {
    parts.push(theme.fg("warning", "truncated"));
  }

  const summary =
    parts.length > 0
      ? parts.join(theme.fg("muted", ", "))
      : theme.fg("muted", "output");
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

  if (lineCount <= 1) {
    const inlineOutput = normalizeOutput(textContent);
    const inlineSummary = [durationSummary, inlineOutput]
      .filter((part): part is string => Boolean(part))
      .join(", ");

    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("toolOutput", inlineSummary || summary)
    );
  }

  return [
    theme.fg(getResultSymbolColor(state), outputLines ? "├─ " : "└─ ") +
      summary,
    outputLines,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function patchBashTool(pi: ExtensionAPI, ctx: ExtensionContext): Handle {
  const tool = createBashTool(ctx.cwd);

  pi.registerTool({
    name: "bash",
    label: "bash",
    description: tool.description,
    promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
    parameters: tool.parameters,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate) {
      const startedAt = Date.now();
      const result = await tool.execute(toolCallId, params, signal, onUpdate);
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
      const text =
        (toolCtx.lastComponent as Text | undefined) ?? new Text("", 1, 0);
      const state = toolCtx.state as BashRenderState;
      const isDone =
        state.hasResult || (!toolCtx.executionStarted && !toolCtx.isPartial);

      updateBlinkTimer(state, !isDone, toolCtx.invalidate);

      if (toolCtx.executionStarted && state.startedAt === undefined) {
        state.startedAt = Date.now();
        state.endedAt = undefined;
      }

      let content = theme.fg(
        getStatusColor(isDone, state),
        `${getStatusSymbol(isDone)} `,
      );

      const commandDisplay =
        theme.fg("dim", "$ ") + theme.bold(theme.fg("accent", args.command));

      const timeoutSuffix = args.timeout
        ? theme.fg("muted", ` (timeout ${args.timeout}s)`)
        : "";

      content += theme.fg("toolTitle", theme.bold("Bash "));
      content += commandDisplay;
      content += timeoutSuffix;

      text.setText(content);
      return text;
    },
    renderResult(result, options, theme, toolCtx) {
      const state = toolCtx.state as BashRenderState;
      const paddingX = options.expanded ? 3 : 1;
      const text =
        state.expanded !== options.expanded
          ? new Text("", paddingX, 0)
          : ((toolCtx.lastComponent as Text | undefined) ??
            new Text("", paddingX, 0));
      state.expanded = options.expanded;

      const details = result.details as BashToolDetails | undefined;

      if (
        state.startedAt !== undefined &&
        options.isPartial &&
        !state.durationTimer
      ) {
        state.durationTimer = setInterval(() => toolCtx.invalidate(), 1000);
      }

      if (!options.isPartial || toolCtx.isError) {
        state.endedAt ??= Date.now();
        if (state.durationTimer) {
          clearInterval(state.durationTimer);
          state.durationTimer = undefined;
        }
      }

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

      text.setText(formatBashResult(result, state, options, theme));

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
