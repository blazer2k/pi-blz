import type {
  ExtensionAPI,
  ExtensionContext,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  createReadTool,
  type ReadToolDetails,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getCapabilities,
  hyperlink,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { Handle } from "../types";

type ReadRenderArgs = {
  path?: string;
  file_path?: string;
  offset?: number;
  limit?: number;
};

function shortenPath(filePath: string): string {
  const home = homedir();
  return filePath.startsWith(home)
    ? `~${filePath.slice(home.length)}`
    : filePath;
}

function renderReadPath(rawPath: unknown, theme: Theme, cwd: string): string {
  if (rawPath == null || rawPath === "") return theme.fg("toolOutput", "...");
  if (typeof rawPath !== "string") return theme.fg("error", "[invalid arg]");

  const styled = theme.fg("accent", shortenPath(rawPath));
  if (!getCapabilities().hyperlinks) return styled;

  const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  return hyperlink(styled, pathToFileURL(absolutePath).href);
}

type Status = "done" | "not_started" | "running";

type ReadRenderState = {
  blinkTimer?: ReturnType<typeof setInterval>;
  hasResult?: boolean;
  truncated?: boolean;
  isError?: boolean;
};

const BLINK_INTERVAL_MS = 500;
const MAX_CALL_WIDTH = 120;
const activeBlinkTimers = new Set<ReturnType<typeof setInterval>>();

function getStatusSymbol(status: Status): string {
  if (status === "done") return "●";
  if (status === "not_started") return "○";

  return Math.floor(Date.now() / BLINK_INTERVAL_MS) % 2 === 0 ? "●" : "○";
}

function getStatusColor(
  status: Status,
  state: ReadRenderState,
): "muted" | "success" | "warning" | "error" {
  if (state.isError) return "error";
  if (state.truncated) return "warning";

  if (status === "not_started") return "muted";

  // Running blink and normal done are both success-colored.
  return "success";
}

function formatReadLineRange(
  args: ReadRenderArgs | undefined,
  theme: Theme,
): string {
  if (args?.offset === undefined && args?.limit === undefined) return "";
  const startLine = args.offset ?? 1;
  const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
  return theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
}

function getResultSymbolColor(
  state: ReadRenderState,
): "dim" | "warning" | "error" {
  if (state.isError) return "error";
  if (state.truncated) return "warning";
  return "dim";
}

function updateBlinkTimer(
  state: ReadRenderState,
  running: boolean,
  invalidate: () => void,
): void {
  if (running && !state.blinkTimer) {
    state.blinkTimer = setInterval(invalidate, BLINK_INTERVAL_MS);
    activeBlinkTimers.add(state.blinkTimer);
    return;
  }

  if (!running && state.blinkTimer) {
    clearInterval(state.blinkTimer);
    activeBlinkTimers.delete(state.blinkTimer);
    state.blinkTimer = undefined;
  }
}

function clearBlinkTimers(): void {
  for (const timer of activeBlinkTimers) {
    clearInterval(timer);
  }
  activeBlinkTimers.clear();
}

function countLines(text: string): number {
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

function formatReadResultSummary(
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  state: ReadRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  const details = result.details as ReadToolDetails | undefined;
  const imageCount = result.content.filter((c) => c.type === "image").length;
  const textContent = result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text ?? "")
    .join("\n");

  const parts: string[] = [];
  if (textContent) {
    const lines = countLines(textContent);
    parts.push(`${lines} ${lines === 1 ? "line" : "lines"}`);
  }
  if (imageCount > 0) {
    parts.push(`${imageCount} ${imageCount === 1 ? "image" : "images"}`);
  }
  if (details?.truncation?.truncated) {
    parts.push("truncated");
  }

  let summary = parts.length > 0 ? parts.join(", ") : "no content";
  const shouldShowHint =
    !options.expanded && (state.truncated || state.isError || imageCount > 0);

  if (summary && shouldShowHint) {
    summary += " (ctrl+o to expand)";
  }

  return (
    theme.fg(getResultSymbolColor(state), "└─ ") +
    theme.fg("toolOutput", summary)
  );
}

export function patchReadTool(pi: ExtensionAPI, ctx: ExtensionContext): Handle {
  const tool = createReadTool(ctx.cwd);

  pi.registerTool({
    name: "read",
    label: "Read",
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
      const state = toolCtx.state as ReadRenderState;
      const status: Status = state.hasResult
        ? "done"
        : !toolCtx.executionStarted
          ? "not_started"
          : toolCtx.isPartial
            ? "running"
            : "done";

      updateBlinkTimer(state, status === "running", toolCtx.invalidate);

      let content = theme.fg(
        getStatusColor(status, state),
        `${getStatusSymbol(status)} `,
      );
      const renderArgs = args as ReadRenderArgs;
      const pathDisplay = renderReadPath(
        renderArgs.path ?? renderArgs.file_path,
        theme,
        toolCtx.cwd,
      );

      content += theme.fg("toolTitle", theme.bold("Read "));
      content += pathDisplay;
      content += formatReadLineRange(renderArgs, theme);

      text.setText(truncateToWidth(content, MAX_CALL_WIDTH));
      return text;
    },
    renderResult(result, options, theme, toolCtx) {
      const text =
        (toolCtx.lastComponent as Text | undefined) ?? new Text("", 1, 0);

      const state = toolCtx.state as ReadRenderState;
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

      text.setText(formatReadResultSummary(result, state, options, theme));

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
