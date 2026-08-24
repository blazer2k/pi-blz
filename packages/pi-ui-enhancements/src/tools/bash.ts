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
  sanitizeMultilineDisplayText,
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
  durationMs?: number;
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
    callExpandable?: boolean;
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
    // The hidden count is rendered as a "┊  N more lines" label line by the
    // caller when tail lines are visible; keep it in metadata only when the
    // tail is hidden entirely (limit = 0).
    if (args.visibleLines === 0) {
      const remainingLines = args.remainingLines ?? 0;
      const suffix = remainingLines === 1 ? "line" : "lines";
      parts.push(theme.fg("muted", `${remainingLines} ${suffix}`));
    }
    needsHint = true;
  }
  if (args.callExpandable && !args.expanded) {
    needsHint = true;
  }
  if (args.lineTruncated) {
    needsHint = true;
  }

  return { parts, needsHint };
}

const BASH_STATUS_PATTERN =
  /^(?:Command exited with code \d+|Command timed out after .+ seconds|Command aborted)$/;

function parseBashErrorText(text: string): {
  output: string;
  status?: string;
} {
  const normalized = normalizeOutput(text).replace(
    /^\(no output\)\n\n(?=Command (?:exited|timed out|aborted))/,
    "",
  );
  const lines = normalized.split("\n");
  const lastLine = lines.at(-1) ?? "";

  if (!BASH_STATUS_PATTERN.test(lastLine)) {
    return { output: normalized };
  }

  const output = lines.slice(0, -1).join("\n").trimEnd();
  return {
    output: output === "(no output)" ? "" : output,
    status: lastLine,
  };
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

function formatHiddenLinesLabel(hiddenLines: number, theme: Theme): string {
  return (
    theme.fg("dim", "┊  ") +
    theme.italic(
      theme.fg(
        "muted",
        `${hiddenLines} more ${hiddenLines === 1 ? "line" : "lines"}`,
      ),
    )
  );
}

function formatOutputLines(
  text: string,
  theme: Theme,
  color: "toolOutput" | "error" = "toolOutput",
  maxLineWidth?: number,
  options: { closeLastLine?: boolean } = {},
): { text: string; truncated: boolean } {
  const { closeLastLine = false } = options;
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
    state.durationMs ??
    (state.startedAt === undefined
      ? undefined
      : (state.endedAt ?? Date.now()) - state.startedAt);
  const durationSummary =
    elapsedMs === undefined
      ? undefined
      : `${options.isPartial ? "elapsed" : "took"} ${formatDuration(elapsedMs)}`;

  if (state.isError) {
    const parsedError = parseBashErrorText(textContent);

    if (!parsedError.status) {
      const collapsedBody = formatErrorBody(
        parsedError.output,
        { ...options, expanded: false },
        theme.fg("error", "..."),
      );
      const errorBody = options.expanded
        ? formatErrorBody(parsedError.output, options, theme.fg("error", "..."))
        : collapsedBody;
      const { parts } = buildBashMetadataParts(
        {
          toolTruncated: state.truncated === true,
          durationSummary,
          expanded: options.expanded,
        },
        theme,
      );
      const metadata = parts.join(theme.fg("muted", " • "));
      const isExpandable =
        collapsedBody.truncated ||
        state.callExpandable === true ||
        state.truncated === true;
      const expansionHint = isExpandable
        ? buildExpansionHint(
            theme,
            options.expanded ? "collapse" : "expand",
            metadata ? "suffix" : "standalone",
          )
        : "";

      if (options.expanded) {
        const outputLines = formatOutputLines(
          errorBody.text,
          theme,
          "error",
          undefined,
          { closeLastLine: true },
        );
        const summary = metadata + expansionHint;
        return [
          summary
            ? theme.fg("dim", outputLines.text ? "├─ " : "╰─ ") + summary
            : undefined,
          outputLines.text,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n");
      }

      const body = errorBody.text || "error";
      const summary = [metadata, theme.fg("error", body)]
        .filter(Boolean)
        .join(theme.fg("muted", " • "));
      return theme.fg("dim", "╰─ ") + summary + expansionHint;
    }

    const limit = MAX_COLLAPSED_LINES();
    const errorLineCount = countLines(parsedError.output);
    const collapsedVisibleLineCount =
      limit === 0 ? 0 : Math.min(errorLineCount, limit);
    const remainingLines = Math.max(
      0,
      errorLineCount - collapsedVisibleLineCount,
    );
    const collapsedOutput =
      limit === 0
        ? ""
        : normalizeOutput(parsedError.output)
            .split("\n")
            .slice(-limit)
            .join("\n");
    const collapsedOutputLines = formatOutputLines(
      collapsedOutput,
      theme,
      "toolOutput",
      getOutputWidth(),
    );
    const isExpandable =
      remainingLines > 0 ||
      collapsedOutputLines.truncated ||
      state.callExpandable === true ||
      state.truncated === true;
    const visibleOutput = options.expanded
      ? normalizeOutput(parsedError.output)
      : collapsedOutput;
    const outputLines = options.expanded
      ? formatOutputLines(visibleOutput, theme, "toolOutput")
      : collapsedOutputLines;
    const { parts } = buildBashMetadataParts(
      {
        durationSummary,
        remainingLines: options.expanded ? 0 : remainingLines,
        visibleLines: options.expanded
          ? errorLineCount
          : collapsedVisibleLineCount,
        toolTruncated: state.truncated === true,
        expanded: options.expanded,
      },
      theme,
    );
    const metadata = parts.join(theme.fg("muted", " • "));
    const expansionHint = isExpandable
      ? buildExpansionHint(
          theme,
          options.expanded ? "collapse" : "expand",
          metadata ? "suffix" : "standalone",
        )
      : "";
    const summary = metadata + expansionHint;
    const showHiddenLabel =
      !options.expanded && collapsedVisibleLineCount > 0 && remainingLines > 0;

    return [
      summary ? theme.fg("dim", "├─ ") + summary : undefined,
      showHiddenLabel
        ? formatHiddenLinesLabel(remainingLines, theme)
        : undefined,
      outputLines.text,
      theme.fg("dim", "╰─ ") + theme.fg("error", parsedError.status),
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  const bashOutput = normalizeOutput(textContent).replace(/\n+$/g, "");
  const limit = MAX_COLLAPSED_LINES();
  const lineCount = countLines(bashOutput);
  const showExpanded = options.expanded && lineCount > 1;
  const visibleLineCount = showExpanded
    ? lineCount
    : limit === 0
      ? 0
      : Math.min(lineCount, limit);
  const remainingLines = Math.max(0, lineCount - visibleLineCount);

  const output = showExpanded
    ? bashOutput
    : limit === 0
      ? ""
      : bashOutput.split("\n").slice(-limit).join("\n");
  const hiddenLines =
    showExpanded || visibleLineCount === 0 ? 0 : remainingLines;
  const outputLines = formatOutputLines(
    output,
    theme,
    "toolOutput",
    showExpanded ? undefined : getOutputWidth(),
    { closeLastLine: true },
  );

  const { parts, needsHint } = buildBashMetadataParts(
    {
      durationSummary,
      remainingLines,
      visibleLines: visibleLineCount,
      callExpandable: state.callExpandable,
      lineTruncated: outputLines.truncated,
      toolTruncated: state.truncated === true,
      expanded: options.expanded,
    },
    theme,
  );

  const metadata = parts.join(theme.fg("muted", " • "));
  const summaryBase = metadata || theme.fg("muted", "output");
  const summary = showExpanded
    ? summaryBase + hint
    : needsHint
      ? metadata +
        buildExpansionHint(theme, "expand", metadata ? "suffix" : "standalone")
      : summaryBase;

  if (lineCount <= 1) {
    const inlineOutput = options.expanded || limit > 0 ? bashOutput : "";
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
          callExpandable: state.callExpandable,
          lineTruncated: shouldTruncate,
          toolTruncated: state.truncated === true,
          expanded: options.expanded,
        },
        theme,
      );

    const baseMetadata = metadataParts.join(theme.fg("muted", " • "));
    const metadataSummary =
      baseMetadata +
      (metadataNeedsHint
        ? buildExpansionHint(
            theme,
            options.expanded ? "collapse" : "expand",
            baseMetadata ? "suffix" : "standalone",
          )
        : "");
    const inlineParts = [
      baseMetadata,
      inlineOutput ? theme.fg("toolOutput", renderedOutput) : undefined,
    ]
      .filter(Boolean)
      .join(theme.fg("muted", " • "));
    const expandedInline =
      (inlineParts || summary) + (options.expanded ? hint : "");
    const useStructuredResult =
      metadataNeedsHint ||
      (options.expanded && visibleWidth(expandedInline) > getOutputWidth());

    if (useStructuredResult) {
      const structuredMetadata = options.expanded
        ? baseMetadata +
          buildExpansionHint(
            theme,
            "collapse",
            baseMetadata ? "suffix" : "standalone",
          )
        : metadataSummary;
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
        structuredMetadata
          ? theme.fg("dim", outputLine ? "├─ " : "╰─ ") + structuredMetadata
          : undefined,
        outputLine,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    }

    return theme.fg("dim", "╰─ ") + expandedInline;
  }

  return [
    theme.fg("dim", outputLines.text ? "├─ " : "╰─ ") + summary,
    hiddenLines > 0 ? formatHiddenLinesLabel(hiddenLines, theme) : undefined,
    outputLines.text,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function patchBashTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createBashToolDefinition);
  const failedDurations = new Map<string, number>();

  const registration = registerPatchedTool({
    pi,
    tool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const startedAt = Date.now();
      try {
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
      } catch (error) {
        failedDurations.set(toolCallId, Date.now() - startedAt);
        throw error;
      }
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
          ? sanitizeMultilineDisplayText(renderArgs.command)
          : "...";
      const collapsedCommand = command.replace(/\s+/g, " ").trim();
      const timeoutText = renderArgs.timeout
        ? `(timeout ${renderArgs.timeout}s)`
        : "";
      const inlineTimeoutSuffix = timeoutText
        ? theme.fg("dim", ` ${timeoutText}`)
        : "";
      const staticWidth =
        visibleWidth(prefix) +
        visibleWidth("Bash ") +
        visibleWidth("$ ") +
        visibleWidth(inlineTimeoutSuffix);
      const commandBudget = Math.max(1, MAX_CALL_WIDTH() - staticWidth);
      const commandTruncated = visibleWidth(collapsedCommand) > commandBudget;
      state.callExpandable = commandTruncated || command.includes("\n");

      const visibleCommand = toolCtx.expanded
        ? command
        : truncateToWidth(
            collapsedCommand,
            commandBudget,
            theme.fg("accent", "..."),
          );
      const commandDisplay =
        theme.fg("dim", "$ ") +
        visibleCommand
          .split("\n")
          .map((line) => theme.bold(theme.fg("accent", line)))
          .join("\n");
      const finalCommandLine = visibleCommand.split("\n").at(-1) ?? "";
      const expandedCommandBudget =
        commandBudget + visibleWidth(inlineTimeoutSuffix);
      const timeoutOnOwnLine =
        toolCtx.expanded &&
        timeoutText.length > 0 &&
        visibleWidth(finalCommandLine + ` ${timeoutText}`) >
          expandedCommandBudget;

      content += theme.fg("toolTitle", theme.bold("Bash "));
      content += commandDisplay;
      content += timeoutOnOwnLine
        ? `\n${theme.fg("dim", timeoutText)}`
        : inlineTimeoutSuffix;
      text.setText(content);
      return text;
    },
    renderResult(result, options, theme, toolCtx) {
      const state = toolCtx.state as BashRenderState;
      const text = getResultText(state, options, toolCtx.lastComponent);

      const details = result.details as BashDetailsWithTiming | undefined;
      const failedDuration = failedDurations.get(toolCtx.toolCallId);
      if (failedDuration !== undefined) {
        state.durationMs = failedDuration;
        if (!options.isPartial) failedDurations.delete(toolCtx.toolCallId);
      }

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

  return {
    dispose() {
      failedDurations.clear();
      registration.dispose();
    },
  };
}
