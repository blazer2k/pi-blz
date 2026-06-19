import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  keyText,
  Theme,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  hyperlink,
  visibleWidth,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";

export type BaseRenderState = {
  blinkTimer?: ReturnType<typeof setInterval>;
  hasResult?: boolean;
  truncated?: boolean;
  isError?: boolean;
  expanded?: boolean;
};

export const MAX_CALL_WIDTH = 80;

const BLINK_INTERVAL_MS = 500;
const activeBlinkTimers = new Set<ReturnType<typeof setInterval>>();
const activeToolTimers = new Set<ReturnType<typeof setInterval>>();

export function isBlinkOn(): boolean {
  return Math.floor(Date.now() / BLINK_INTERVAL_MS) % 2 === 0;
}

export function getStatusSymbol(isDone: boolean): string {
  if (isDone) return "●";
  return isBlinkOn() ? "●" : "○";
}

export function getResultSymbolColor(
  state: BaseRenderState,
): "dim" | "warning" | "error" {
  if (state.isError) return "error";
  if (state.truncated) return "warning";
  return "dim";
}

export function getStatusColor(
  isDone: boolean,
  state: BaseRenderState,
): "success" | "warning" | "error" | "dim" {
  if (state.isError) return "error";
  if (state.truncated) return "warning";

  if (!isDone) return isBlinkOn() ? "success" : "dim";
  return "success";
}

function shortenPath(filePath: string): string {
  const home = homedir();
  return filePath.startsWith(home)
    ? `~${filePath.slice(home.length)}`
    : filePath;
}

function truncatePathMiddle(filePath: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (visibleWidth(filePath) <= maxWidth) return filePath;

  const parts = filePath.split("/");
  const filename = parts.pop() ?? "";
  if (!filename || parts.length === 0) {
    return truncateToWidth(filePath, maxWidth, "...");
  }

  const maxHeadCount = Math.min(parts.length, 6);
  for (let headCount = maxHeadCount; headCount >= 0; headCount--) {
    for (
      let tailCount = parts.length - headCount - 1;
      tailCount >= 0;
      tailCount--
    ) {
      const head = parts.slice(0, headCount);
      const tail = tailCount === 0 ? [] : parts.slice(-tailCount);
      const candidate = [...head, "...", ...tail, filename].join("/");
      if (visibleWidth(candidate) <= maxWidth) {
        return candidate;
      }
    }
  }

  const prefix = ".../";
  const filenameWidth = Math.max(1, maxWidth - visibleWidth(prefix));
  return prefix + truncateToWidth(filename, filenameWidth, "...");
}

export function renderPath(
  rawPath: unknown,
  theme: Theme,
  cwd: string,
  maxWidth?: number,
): string {
  if (rawPath == null || rawPath === "") return theme.fg("toolOutput", "...");
  if (typeof rawPath !== "string") return theme.fg("error", "[invalid arg]");

  const displayPath = shortenPath(rawPath);
  const visiblePath =
    maxWidth === undefined
      ? displayPath
      : truncatePathMiddle(displayPath, maxWidth);
  const styled = theme.fg("accent", visiblePath);
  if (!getCapabilities().hyperlinks) return styled;

  const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  return hyperlink(styled, pathToFileURL(absolutePath).href);
}

export function updateBlinkTimer(
  state: BaseRenderState,
  shouldBlink: boolean,
  invalidate: () => void,
): void {
  if (shouldBlink && !state.blinkTimer) {
    state.blinkTimer = setInterval(invalidate, BLINK_INTERVAL_MS);
    activeBlinkTimers.add(state.blinkTimer);
    return;
  }

  if (!shouldBlink && state.blinkTimer) {
    clearInterval(state.blinkTimer);
    activeBlinkTimers.delete(state.blinkTimer);
    state.blinkTimer = undefined;
  }
}

export function registerToolTimer(timer: ReturnType<typeof setInterval>): void {
  activeToolTimers.add(timer);
}

export function unregisterToolTimer(
  timer: ReturnType<typeof setInterval>,
): void {
  activeToolTimers.delete(timer);
}

export function clearBlinkTimers(): void {
  for (const timer of activeBlinkTimers) {
    clearInterval(timer);
  }
  activeBlinkTimers.clear();

  for (const timer of activeToolTimers) {
    clearInterval(timer);
  }
  activeToolTimers.clear();
}

export function buildHint(theme: Theme): string {
  return (
    theme.fg("dim", " (") +
    theme.fg("dim", keyText("app.tools.expand")) +
    theme.fg("dim", " to expand)")
  );
}

export function normalizeOutput(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function countLines(text: string): number {
  const trimmed = normalizeOutput(text);
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

export function extractTextContent(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text ?? "")
    .join("\n");
}

export function getMaxErrorLineWidth(): number {
  return Math.floor(MAX_CALL_WIDTH / 2);
}

export function formatErrorBody(
  textContent: string,
  options: ToolRenderResultOptions,
  ellipsis = "...",
): { text: string; truncated: boolean } {
  const output = normalizeOutput(textContent);
  const lines = output.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end--;
  }
  const trimmed = lines.slice(0, end);

  if (options.expanded) {
    return {
      text: trimmed.join("\n"),
      truncated: false,
    };
  }

  const maxLineWidth = getMaxErrorLineWidth();
  const joined = trimmed.join("\n");

  if (trimmed.length === 1 && visibleWidth(joined) <= maxLineWidth) {
    return { text: joined, truncated: false };
  }

  return {
    text: truncateToWidth(joined, maxLineWidth, ellipsis),
    truncated: true,
  };
}

export function formatSimpleErrorResult(
  textContent: string,
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  const errorBody = formatErrorBody(
    textContent,
    options,
    theme.fg("error", "..."),
  );
  const lines = errorBody.text.split("\n");

  const formatted = lines
    .map((line, index) => {
      const prefix = index === lines.length - 1 ? "└─ " : "│  ";
      return formatTreeLine(line, {
        theme,
        state,
        prefix,
        width: MAX_CALL_WIDTH - 1,
        mode: "preserve",
        color: "error",
      }).text;
    })
    .join("\n");

  if (options.expanded) {
    return formatted;
  }

  const suffix = errorBody.truncated ? buildHint(theme) : "";
  return (
    theme.fg(getResultSymbolColor(state), "└─ ") +
    theme.fg("error", errorBody.text) +
    suffix
  );
}

export function formatTreeLine(
  line: string,
  options: {
    theme: Theme;
    state: BaseRenderState;
    prefix: "│  " | "├─ " | "└─ ";
    width: number;
    mode: "truncate" | "preserve";
    color?: "toolOutput" | "error" | "muted";
  },
): { text: string; truncated: boolean } {
  const { theme, state, prefix, width, mode, color } = options;
  const contentWidth = Math.max(1, width - visibleWidth(prefix));
  const truncated = mode === "truncate" && visibleWidth(line) > contentWidth;
  const renderedLine = truncated
    ? truncateToWidth(line, contentWidth, theme.fg(color ?? "muted", "..."))
    : line;
  const styledLine =
    color === undefined ? renderedLine : theme.fg(color, renderedLine);

  return {
    text: theme.fg(getResultSymbolColor(state), prefix) + styledLine,
    truncated,
  };
}

export function getCallRenderParts(
  state: BaseRenderState,
  theme: Theme,
  toolCtx: {
    executionStarted?: boolean;
    isPartial?: boolean;
    invalidate: () => void;
  },
  paddingX = 1,
): { text: Text; prefix: string; isDone: boolean } {
  const text = new Text("", paddingX, 0);

  const isDone =
    state.hasResult || (!toolCtx.executionStarted && !toolCtx.isPartial);

  updateBlinkTimer(state, !isDone, toolCtx.invalidate);

  const prefix = theme.fg(
    getStatusColor(isDone, state),
    `${getStatusSymbol(isDone)} `,
  );

  return { text, prefix, isDone };
}

export function getResultText(
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  lastComponent: unknown,
  renderOptions?: { paddingX?: number },
): Text {
  const paddingX = renderOptions?.paddingX ?? 1;
  const text =
    state.expanded !== options.expanded
      ? new Text("", paddingX, 0)
      : ((lastComponent as Text | undefined) ?? new Text("", paddingX, 0));

  state.expanded = options.expanded;
  return text;
}

export function updateResultState(
  state: BaseRenderState,
  next: {
    hasResult?: boolean;
    truncated?: boolean;
    isError?: boolean;
  },
): boolean {
  const nextHasResult = next.hasResult ?? true;
  const nextTruncated = next.truncated ?? false;
  const nextIsError = next.isError ?? false;

  const changed =
    state.hasResult !== nextHasResult ||
    state.truncated !== nextTruncated ||
    state.isError !== nextIsError;

  state.hasResult = nextHasResult;
  state.truncated = nextTruncated;
  state.isError = nextIsError;

  return changed;
}

export function invalidateIfChanged(
  changed: boolean,
  invalidate: () => void,
): void {
  if (changed) {
    queueMicrotask(invalidate);
  }
}
