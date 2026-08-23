import type {
  ExtensionAPI,
  ToolRenderResultOptions,
  Theme,
  BashToolDetails,
} from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";
import {
  type BaseRenderState,
  MAX_CALL_WIDTH,
  MAX_COLLAPSED_LINES,
  buildExpansionHint,
  buildResultStatusParts,
  countLines,
  extractTextContent,
  formatErrorBody,
  formatTreeLine,
  getCallRenderParts,
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
  ReturnType<typeof createBashToolDefinition>["execute"]
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
    visibleLines?: number;
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
  parts.push(
    ...buildResultStatusParts({ truncated: args.toolTruncated }, theme),
  );
  if ((args.remainingLines ?? 0) > 0) {
    const remainingLines = args.remainingLines ?? 0;
    const suffix = remainingLines === 1 ? "line" : "lines";
    parts.push(
      theme.fg(
        "muted",
        args.visibleLines === 0
          ? `${remainingLines} ${suffix}`
          : `${remainingLines} more ${suffix}`,
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
  color: "toolOutput" | "error" = "toolOutput",
  maxLineWidth?: number,
  closeLastLine = false,
): { text: string; truncated: boolean } {
  const output = normalizeOutput(text);
  if (!output) return { text: "", truncated: false };

  let truncated = false;
  const lines = output.split("\n");
  const renderedLines = lines.map((line, index) => {
    const prefix = closeLastLine && index === lines.length - 1 ? "╰─ " : "│  ";
    const rendered = formatTreeLine(line, {
      theme,
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

  const hint = buildExpansionHint(
    theme,
    options.expanded ? "collapse" : "expand",
  );
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
      normalizeBashErrorText(textContent),
      options,
      theme.fg("error", "..."),
    );

    if (options.expanded) {
      const { parts } = buildBashMetadataParts(
        {
          toolTruncated: state.truncated === true,
          durationSummary,
          expanded: true,
        },
        theme,
      );
      const summary = parts.join(theme.fg("muted", " • "));
      const outputLines = formatOutputLines(
        errorBody.text,
        theme,
        "error",
        undefined,
        true,
      );
      const summaryLine = summary
        ? theme.fg("dim", outputLines.text ? "├─ " : "╰─ ") + summary + hint
        : undefined;
      return [summaryLine, outputLines.text]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    }

    const errorText = normalizeBashErrorText(textContent);
    const lineCount = countLines(errorText);

    if (lineCount > 1) {
      const limit = MAX_COLLAPSED_LINES();
      const visibleLineCount = limit === 0 ? 0 : Math.min(lineCount, limit);
      const remainingLines = Math.max(0, lineCount - visibleLineCount);
      const output =
        limit === 0
          ? ""
          : normalizeOutput(errorText).split("\n").slice(-limit).join("\n");
      const outputLines = formatOutputLines(
        output,
        theme,
        "error",
        getOutputWidth(),
        true,
      );
      const { parts, needsHint } = buildBashMetadataParts(
        {
          durationSummary,
          remainingLines,
          visibleLines: visibleLineCount,
          callTruncated: state.callTruncated,
          lineTruncated: outputLines.truncated,
          toolTruncated: state.truncated === true,
          expanded: options.expanded,
        },
        theme,
      );
      const summary =
        parts.join(theme.fg("muted", " • ")) + (needsHint ? hint : "");
      const summaryLine = summary
        ? theme.fg("dim", outputLines.text ? "├─ " : "╰─ ") + summary
        : undefined;

      return [summaryLine, outputLines.text]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    }

    const { parts, needsHint } = buildBashMetadataParts(
      {
        toolTruncated: state.truncated === true,
        durationSummary,
        callTruncated: state.callTruncated,
        lineTruncated: errorBody.truncated,
        expanded: options.expanded,
      },
      theme,
    );
    if (errorBody.text) parts.push(theme.fg("error", errorBody.text));
    return (
      theme.fg("dim", "╰─ ") +
      parts.join(theme.fg("muted", " • ")) +
      (options.expanded || needsHint ? hint : "")
    );
  }

  const limit = MAX_COLLAPSED_LINES();
  const lineCount = countLines(textContent);
  const showExpanded = options.expanded && lineCount > 1;
  const visibleLineCount = showExpanded
    ? lineCount
    : limit === 0
      ? 0
      : Math.min(lineCount, limit);
  const remainingLines = Math.max(0, lineCount - visibleLineCount);

  const output = showExpanded
    ? normalizeOutput(textContent)
    : limit === 0
      ? ""
      : normalizeOutput(textContent).split("\n").slice(-limit).join("\n");
  const outputLines = formatOutputLines(
    output,
    theme,
    "toolOutput",
    showExpanded ? undefined : getOutputWidth(),
    true,
  );

  const { parts, needsHint } = buildBashMetadataParts(
    {
      durationSummary,
      remainingLines,
      visibleLines: visibleLineCount,
      callTruncated: state.callTruncated,
      lineTruncated: outputLines.truncated,
      toolTruncated: state.truncated === true,
      expanded: options.expanded,
    },
    theme,
  );

  const summary =
    parts.length > 0
      ? parts.join(theme.fg("muted", " • ")) + (needsHint ? hint : "")
      : theme.fg("muted", "output");

  if (lineCount <= 1) {
    const inlineOutput =
      options.expanded || limit > 0 ? normalizeOutput(textContent) : "";
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
          toolTruncated: state.truncated === true,
          expanded: options.expanded,
        },
        theme,
      );

    const metadataSummary =
      metadataParts.length > 0
        ? metadataParts.join(theme.fg("muted", " • ")) +
          (metadataNeedsHint ? hint : "")
        : "";

    if (
      metadataNeedsHint ||
      (options.expanded && renderedOutput && shouldTruncate)
    ) {
      const outputLine = renderedOutput
        ? formatTreeLine(renderedOutput, {
            theme,
            prefix: "╰─ ",
            width: getOutputWidth() + 3,
            mode: options.expanded ? "preserve" : "truncate",
            color: "toolOutput",
          }).text
        : undefined;
      return [
        metadataSummary
          ? theme.fg("dim", outputLine ? "├─ " : "╰─ ") + metadataSummary
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
      .join(theme.fg("muted", " • "));

    return (
      theme.fg("dim", "╰─ ") +
      (inlineParts || summary) +
      (options.expanded ? hint : "")
    );
  }

  return [
    theme.fg("dim", outputLines.text ? "├─ " : "╰─ ") +
      summary +
      (showExpanded ? hint : ""),
    outputLines.text,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function patchBashTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createBashToolDefinition);

  return registerPatchedTool({
    pi,
    tool,
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
        ? theme.fg("dim", ` (timeout ${renderArgs.timeout}s)`)
        : "";
      const staticWidth =
        visibleWidth(prefix) +
        visibleWidth("Bash ") +
        visibleWidth("$ ") +
        visibleWidth(timeoutSuffix);
      const commandBudget = Math.max(1, MAX_CALL_WIDTH() - staticWidth);
      const commandTruncated =
        !toolCtx.expanded && visibleWidth(commandPreview) > commandBudget;
      const visibleCommand = toolCtx.expanded
        ? commandPreview
        : truncateToWidth(
            commandPreview,
            commandBudget,
            theme.fg("accent", "..."),
          );
      const commandDisplay =
        theme.fg("dim", "$ ") +
        visibleCommand
          .split("\n")
          .map((line) => theme.bold(theme.fg("accent", line)))
          .join("\n");
      content += theme.fg("toolTitle", theme.bold("Bash "));
      content += commandDisplay;
      content += timeoutSuffix;
      state.callTruncated = commandTruncated;
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

      text.setText(formatBashResult(result, state, options, theme));

      return text;
    },
  });
}
