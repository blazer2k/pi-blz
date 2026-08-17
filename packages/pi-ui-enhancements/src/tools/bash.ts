import type {
  ExtensionAPI,
  ToolRenderResultOptions,
  Theme,
  BashToolDetails,
} from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
import { TOOL_PROMPTS } from "./tool-prompts";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";
import {
  type BaseRenderState,
  MAX_CALL_WIDTH,
  buildHint,
  countLines,
  extractTextContent,
  formatErrorBody,
  formatTreeLine,
  getCachedFormat,
  getCallRenderParts,
  getFormatCacheKey,
  getResultSymbolColor,
  getResultText,
  invalidateIfChanged,
  normalizeOutput,
  registerToolTimer,
  sanitizeDisplayText,
  unregisterToolTimer,
  updateResultState,
} from "./tool-rendering";

const DURATION_UPDATE_INTERVAL_MS = 250;

type BashToolInput = Parameters<
  ReturnType<typeof createBashTool>["execute"]
>[1];

type BashRenderState = BaseRenderState & {
  startedAt?: number;
  endedAt?: number;
  durationTimer?: ReturnType<typeof setInterval>;
  callTruncated?: boolean;
  fullCommand?: string;
};

type BashDetailsWithTiming = BashToolDetails & {
  durationMs?: number;
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Reserved width for the tree-drawing prefix chain:
// "● " (status symbol + space) + "├─ " (tree connector) + 1 buffer
const TREE_PREFIX_WIDTH = 6;

function getOutputWidth(): number {
  return Math.max(1, MAX_CALL_WIDTH() - TREE_PREFIX_WIDTH);
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

function normalizeBashErrorText(text: string): string {
  return normalizeOutput(text)
    .replace(/^\(no output\)\n\n(?=Command exited with code \d+)/, "")
    .replace(/\n{3,}(?=Command exited with code \d+)/, "\n");
}

function stripBashTruncationNotice(
  text: string,
  details: BashDetailsWithTiming | undefined,
): string {
  if (!details?.truncation?.truncated && !details?.fullOutputPath) return text;

  const normalized = normalizeOutput(text);
  const footerStart = normalized.lastIndexOf("\n\n[");
  if (footerStart === -1 || !normalized.endsWith("]")) return text;

  const footer = normalized.slice(footerStart);
  if (details.fullOutputPath && !footer.includes(details.fullOutputPath)) {
    return text;
  }
  if (!details.fullOutputPath && !footer.includes("Showing lines")) {
    return text;
  }

  return normalized.slice(0, footerStart).trimEnd();
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
  const rawTextContent = extractTextContent(result);
  const textContent = state.isError
    ? rawTextContent
    : stripBashTruncationNotice(rawTextContent, details);

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

  // Prepend full command line when expanded and call was truncated
  const commandLine =
    options.expanded && state.callTruncated && state.fullCommand
      ? theme.fg(getResultSymbolColor(state), "│  ") +
        theme.fg("dim", "$ ") +
        theme.fg("accent", state.fullCommand.replace(/\s+/g, " ").trim())
      : undefined;

  if (state.isError) {
    const errorBody = formatErrorBody(
      normalizeBashErrorText(textContent),
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
        commandLine,
        theme.fg(
          getResultSymbolColor(state),
          outputLines.text ? "├─ " : "└─ ",
        ) + theme.fg("error", summary),
        outputLines.text,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    }

    const errorText = normalizeBashErrorText(textContent);
    const lineCount = countLines(errorText);

    if (lineCount > 1) {
      const visibleLineCount = Math.min(lineCount, 5);
      const remainingLines = Math.max(0, lineCount - visibleLineCount);
      const output = normalizeOutput(errorText)
        .split("\n")
        .slice(-5)
        .join("\n");
      const outputLines = formatOutputLines(
        output,
        theme,
        state,
        "error",
        getOutputWidth(),
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
      const summaryParts = durationSummary
        ? [parts[0]!, theme.fg("error", "error"), ...parts.slice(1)]
        : [theme.fg("error", "error"), ...parts];
      const summary =
        summaryParts.join(theme.fg("muted", ", ")) + (needsHint ? hint : "");

      return [
        commandLine,
        theme.fg(
          getResultSymbolColor(state),
          outputLines.text ? "├─ " : "└─ ",
        ) + summary,
        outputLines.text,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    }

    const prefix = durationSummary ? `${durationSummary}, ` : "";
    const suffix = errorBody.truncated || state.callTruncated ? hint : "";
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

    if (
      metadataNeedsHint ||
      commandLine ||
      (options.expanded && renderedOutput && shouldTruncate)
    ) {
      const outputLine = renderedOutput
        ? formatTreeLine(renderedOutput, {
            theme,
            state,
            prefix: "└─ ",
            width: getOutputWidth() + 3,
            mode: options.expanded ? "preserve" : "truncate",
            color: "toolOutput",
          }).text
        : undefined;
      return [
        commandLine,
        metadataSummary
          ? theme.fg(getResultSymbolColor(state), outputLine ? "├─ " : "└─ ") +
            metadataSummary
          : undefined,
        outputLine,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    }

    const inlineParts = [
      metadataSummary,
      inlineOutput ? theme.fg("toolOutput", renderedOutput) : undefined,
    ]
      .filter(Boolean)
      .join(theme.fg("muted", ", "));

    return (
      theme.fg(getResultSymbolColor(state), "└─ ") + (inlineParts || summary)
    );
  }

  return [
    commandLine,
    theme.fg(getResultSymbolColor(state), outputLines.text ? "├─ " : "└─ ") +
      summary,
    outputLines.text,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function patchBashTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createBashTool);

  return registerPatchedTool({
    pi,
    tool,
    name: "bash",
    label: "bash",
    promptSnippet: TOOL_PROMPTS.bash.promptSnippet,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const startedAt = Date.now();
      const result = await tool.execute(
        toolCallId,
        params as BashToolInput,
        signal,
        onUpdate,
        ctx,
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
      const command =
        typeof renderArgs.command === "string"
          ? sanitizeDisplayText(renderArgs.command)
          : "...";
      const commandPreview = toolCtx.expanded
        ? command
        : command.replace(/\s+/g, " ").trim();
      const timeoutSuffix = renderArgs.timeout
        ? theme.fg("muted", ` (timeout ${renderArgs.timeout}s)`)
        : "";
      const staticWidth =
        visibleWidth(prefix) +
        visibleWidth("Bash ") +
        visibleWidth("$ ") +
        visibleWidth(timeoutSuffix);
      const commandBudget = Math.max(1, MAX_CALL_WIDTH() - staticWidth);
      const commandTruncated = visibleWidth(commandPreview) > commandBudget;
      const commandDisplay =
        theme.fg("dim", "$ ") +
        theme.bold(
          theme.fg(
            "accent",
            truncateToWidth(
              commandPreview,
              commandBudget,
              theme.fg("accent", "..."),
            ),
          ),
        );
      content += theme.fg("toolTitle", theme.bold("Bash "));
      content += commandDisplay;
      content += timeoutSuffix;
      state.callTruncated = commandTruncated;
      state.fullCommand = command;
      text.setText(content);
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
        state.durationTimer = setInterval(
          () => toolCtx.invalidate(),
          DURATION_UPDATE_INTERVAL_MS,
        );
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
        hasResult: !options.isPartial,
        truncated: details?.truncation?.truncated === true,
        isError: toolCtx.isError,
      });

      invalidateIfChanged(changed, toolCtx.invalidate);

      if (options.isPartial) {
        text.setText(formatBashResult(result, state, options, theme));
      } else {
        const key = [
          getFormatCacheKey(options),
          toolCtx.isError ? "error" : "ok",
          state.truncated ? "truncated" : "full",
        ].join(":");
        text.setText(
          getCachedFormat(state, key, { result, theme }, () =>
            formatBashResult(result, state, options, theme),
          ),
        );
      }

      return text;
    },
  });
}
