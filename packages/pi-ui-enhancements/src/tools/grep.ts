import type {
  ExtensionAPI,
  ExtensionContext,
  ToolRenderResultOptions,
  GrepToolDetails,
  Theme,
  GrepToolInput,
} from "@earendil-works/pi-coding-agent";
import { createGrepTool } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
import { TOOL_PROMPTS } from "./tool-prompts";
import { registerPatchedTool } from "./tool-registration";
import {
  type BaseRenderState,
  MAX_CALL_WIDTH,
  MAX_EXPANDED_ENTRIES,
  buildHint,
  extractTextContent,
  formatSimpleErrorResult,
  formatTreeLine,
  getCallRenderParts,
  getResultSymbolColor,
  getResultText,
  invalidateIfChanged,
  normalizeOutput,
  renderPath,
  updateResultState,
} from "./tool-rendering";

function formatGrepResult(
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  const details = result.details as GrepToolDetails | undefined;
  const textContent = extractTextContent(result);

  if (state.isError) {
    return formatSimpleErrorResult(textContent, state, options, theme);
  }

  const hint = buildHint(theme);

  const normalized = normalizeOutput(textContent);
  if (normalized === "" || normalized === "No matches found") {
    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("muted", "(no matches found)")
    );
  }

  // Strip trailing notice block appended by the grep tool, e.g.
  // "\n\n[100 matches limit reached. Use limit=200 for more, or refine pattern]"
  const body = normalized.includes("\n\n[")
    ? normalized.slice(0, normalized.lastIndexOf("\n\n["))
    : normalized;

  const lines = body.split("\n").filter((f) => f.length > 0);
  const totalLines = lines.length;

  const summaryParts: string[] = [];
  summaryParts.push(
    `${totalLines} ${totalLines === 1 ? "line" : "lines"}`,
  );

  if (details?.matchLimitReached !== undefined) {
    summaryParts.push(
      theme.fg("warning", `${details.matchLimitReached} limit`),
    );
  }
  if (details?.truncation?.truncated || details?.linesTruncated) {
    summaryParts.push(theme.fg("warning", "truncated"));
  }

  const summary = summaryParts.join(theme.fg("toolOutput", ", "));

  if (!options.expanded) {
    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("toolOutput", summary) +
      hint
    );
  }

  const visibleLines = lines.slice(0, MAX_EXPANDED_ENTRIES);
  const remaining = Math.max(0, totalLines - MAX_EXPANDED_ENTRIES);

  const rendered: string[] = [];

  rendered.push(
    theme.fg(getResultSymbolColor(state), "├─ ") +
      theme.fg("toolOutput", summary),
  );

  visibleLines.forEach((line, index) => {
    const isLastVisible =
      index === visibleLines.length - 1 && remaining === 0;
    const prefix: "│  " | "└─ " = isLastVisible ? "└─ " : "│  ";

    const treeLine = formatTreeLine(line, {
      theme,
      state,
      prefix,
      width: MAX_CALL_WIDTH - 1,
      mode: "preserve",
    });
    rendered.push(treeLine.text);
  });

  if (remaining > 0) {
    rendered.push(
      theme.fg(getResultSymbolColor(state), "└─ ") +
        theme.fg("muted", `${remaining} more lines`),
    );
  }

  return rendered.join("\n");
}

export function patchGrepTool(pi: ExtensionAPI, ctx: ExtensionContext): Handle {
  const tool = createGrepTool(ctx.cwd);

  return registerPatchedTool({
    pi,
    tool,
    name: "grep",
    label: "grep",
    promptSnippet: TOOL_PROMPTS.grep.promptSnippet,
    renderCall(args, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      let content = prefix;

      const renderArgs = args as GrepToolInput;
      const title = theme.fg("toolTitle", theme.bold("Grep "));
      const pattern = theme.fg("success", renderArgs.pattern);
      const glob = renderArgs.glob
        ? theme.fg("muted", ` ${renderArgs.glob}`)
        : "";
      const context = renderArgs.context
        ? theme.fg("muted", ` ±${renderArgs.context}`)
        : "";
      const limit = renderArgs.limit
        ? theme.fg("muted", ` (limit ${renderArgs.limit})`)
        : "";
      const pathPrefix = renderArgs.path ? " in " : "";
      const pathDisplay = renderArgs.path
        ? `${pathPrefix}${renderPath(
            renderArgs.path,
            theme,
            toolCtx.cwd,
            Math.max(
              1,
              MAX_CALL_WIDTH -
                visibleWidth(
                  content +
                    title +
                    pattern +
                    pathPrefix +
                    glob +
                    context +
                    limit,
                ),
            ),
          )}`
        : "";

      content += title;
      content += pattern;
      content += pathDisplay;
      content += glob;
      content += context;
      content += limit;

      text.setText(
        truncateToWidth(content, MAX_CALL_WIDTH, theme.fg("accent", "...")),
      );
      return text;
    },
    renderResult(result, options, theme, toolCtx) {
      const state = toolCtx.state as BaseRenderState;
      const text = getResultText(state, options, toolCtx.lastComponent);

      const details = result.details as GrepToolDetails | undefined;

      const changed = updateResultState(state, {
        truncated: details?.truncation?.truncated === true || details?.linesTruncated === true,
        isError: toolCtx.isError,
      });

      invalidateIfChanged(changed, toolCtx.invalidate);

      text.setText(formatGrepResult(result, state, options, theme));
      return text;
    },
  });
}
