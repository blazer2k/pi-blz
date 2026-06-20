import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  keyText,
  Theme,
  type ExtensionAPI,
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

export type ListResultConfig = {
  emptyMessage: string;
  singularLabel: string; // "entry" | "file" | "line"
  pluralLabel: string; // "entries" | "files" | "lines"
  moreLabel: string; // "more entries" | "more files" | "more lines"
  details: {
    limitKey?: string; // "entryLimitReached" | "resultLimitReached" | "matchLimitReached"
    extraTruncated?: (d: object) => boolean; // e.g. d => d.linesTruncated
  };
  preprocess: (text: string) => string[]; // split + optional notice stripping
  renderItem?: (item: string, theme: Theme) => string; // e.g. color directories
};

export type FormatResultFn = (
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
) => string;

export const MAX_CALL_WIDTH = 80;

/** Maximum number of entries to display in expanded list views (ls, find). */
export const MAX_EXPANDED_ENTRIES = 20;

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
  emptyFallback = "...",
): string {
  if (rawPath == null || rawPath === "") {
    return theme.fg("toolOutput", emptyFallback);
  }
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

function getOpenOsc8Terminator(
  text: string,
): "\u0007" | "\u001B\\" | undefined {
  let active: "\u0007" | "\u001B\\" | undefined;
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf("\u001B]8;", index);
    if (start === -1) break;

    const belEnd = text.indexOf("\u0007", start + 4);
    const stEnd = text.indexOf("\u001B\\", start + 4);
    const usesBel = belEnd !== -1 && (stEnd === -1 || belEnd < stEnd);
    const end = usesBel ? belEnd : stEnd;
    if (end === -1) break;

    const body = text.slice(start + 4, end);
    const separator = body.indexOf(";");
    if (separator !== -1) {
      const url = body.slice(separator + 1);
      active = url ? (usesBel ? "\u0007" : "\u001B\\") : undefined;
    }

    index = end + (usesBel ? 1 : 2);
  }

  return active;
}

export function closeOpenHyperlink(text: string): string {
  const terminator = getOpenOsc8Terminator(text);
  return terminator ? `${text}\u001B]8;;${terminator}` : text;
}

export function safeTruncateToWidth(
  text: string,
  maxWidth: number,
  ellipsis = "...",
  pad = false,
): string {
  return closeOpenHyperlink(truncateToWidth(text, maxWidth, ellipsis, pad));
}

export function normalizeOutput(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function countLines(text: string): number {
  const trimmed = normalizeOutput(text);
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

function stripAnsi(value: string): string {
  if (!value.includes("\u001B") && !value.includes("\u009B")) return value;

  // Kept in sync with pi's display sanitizer
  const st = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:\\u001B\\][\\s\\S]*?${st})`;
  const csi =
    "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  return value.replace(new RegExp(`${osc}|${csi}`, "g"), "");
}

function sanitizeTextOutput(value: string): string {
  return Array.from(stripAnsi(value))
    .filter((char) => {
      const code = char.codePointAt(0);
      if (code === undefined) return false;
      if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
      if (code <= 0x1f) return false;
      if (code >= 0xfff9 && code <= 0xfffb) return false;
      return true;
    })
    .join("")
    .replace(/\r/g, "");
}

export function extractTextContent(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return sanitizeTextOutput(
    result.content
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text ?? "")
      .join("\n"),
  );
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

export function formatListResult(
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  config: ListResultConfig,
): string {
  if (state.isError) {
    return formatSimpleErrorResult(
      extractTextContent(result),
      state,
      options,
      theme,
    );
  }

  const normalized = normalizeOutput(extractTextContent(result));
  if (normalized === "" || normalized === config.emptyMessage) {
    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("muted", config.emptyMessage)
    );
  }

  const items = config.preprocess(normalized);
  const total = items.length;
  const label = total === 1 ? config.singularLabel : config.pluralLabel;

  const details = result.details as Record<string, unknown> | undefined;
  const summaryParts: string[] = [`${total} ${label}`];

  if (
    config.details.limitKey &&
    details?.[config.details.limitKey] !== undefined
  ) {
    summaryParts.push(
      theme.fg("warning", `${details[config.details.limitKey]} limit`),
    );
  }

  const truncation = details?.truncation as { truncated?: boolean } | undefined;
  if (truncation?.truncated || config.details.extraTruncated?.(details ?? {})) {
    summaryParts.push(theme.fg("warning", "truncated"));
  }

  const summary = summaryParts.join(theme.fg("toolOutput", ", "));

  if (!options.expanded) {
    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("toolOutput", summary) +
      buildHint(theme)
    );
  }

  const visible = items.slice(0, MAX_EXPANDED_ENTRIES);
  const remaining = Math.max(0, total - MAX_EXPANDED_ENTRIES);
  const lines: string[] = [
    theme.fg(getResultSymbolColor(state), "├─ ") +
      theme.fg("toolOutput", summary),
  ];

  visible.forEach((item, index) => {
    const isLast = index === visible.length - 1 && remaining === 0;
    const prefix: "│  " | "└─ " = isLast ? "└─ " : "│  ";
    const rendered = config.renderItem ? config.renderItem(item, theme) : item;
    lines.push(
      formatTreeLine(rendered, {
        theme,
        state,
        prefix,
        width: MAX_CALL_WIDTH - 1,
        mode: "preserve",
      }).text,
    );
  });

  if (remaining > 0) {
    lines.push(
      theme.fg(getResultSymbolColor(state), "└─ ") +
        theme.fg("muted", `${remaining} ${config.moreLabel}`),
    );
  }

  return lines.join("\n");
}

export function buildRenderResult(
  formatFn: FormatResultFn,
  truncationCheck?: (details: unknown) => boolean,
): NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["renderResult"]> {
  return (result, options, theme, toolCtx) => {
    const state = toolCtx.state as BaseRenderState;
    const text = getResultText(state, options, toolCtx.lastComponent);

    const changed = updateResultState(state, {
      truncated: truncationCheck
        ? truncationCheck(result.details)
        : (
            result.details as
              | { truncation?: { truncated?: boolean } }
              | undefined
          )?.truncation?.truncated === true,
      isError: toolCtx.isError,
    });

    invalidateIfChanged(changed, toolCtx.invalidate);
    text.setText(formatFn(result, state, options, theme));
    return text;
  };
}
