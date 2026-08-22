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
  sliceByColumn,
  Text,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { getConfig } from "../config";
import { shortenPath } from "../path-utils";

export type BaseRenderState = {
  blinkTimer?: { invalidate: () => void };
  hasResult?: boolean;
  truncated?: boolean;
  isError?: boolean;
  expanded?: boolean;
  /** Captured blink phase shared between renderCall and renderResult */
  blinkOn?: boolean;
};

export type ResultStatusState = BaseRenderState & {
  truncated: boolean;
  isError: boolean;
};

export type ListResultConfig = {
  emptyMessage: string;
  singularLabel: string; // "entry" | "file" | "line"
  pluralLabel: string; // "entries" | "files" | "lines"
  moreLabel: string; // "more entries" | "more files" | "more lines"
  preprocess: (text: string) => string[]; // split + optional notice stripping
  renderItem?: (item: string, theme: Theme) => string; // e.g. color directories
};

export type FormatResultFn = (
  result: {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  state: ResultStatusState,
  options: ToolRenderResultOptions,
  theme: Theme,
) => string;

export function MAX_CALL_WIDTH(): number {
  return getConfig().maxCallWidth;
}

// Maximum number of entries to display in expanded list views (ls, find).
// -1 means unbounded.
export function MAX_EXPANDED_ENTRIES(): number {
  const val = getConfig().maxExpandedEntries;
  return val === -1 ? Infinity : val;
}

const BLINK_INTERVAL_MS = 500;
const activeBlinkTimers = new Set<NonNullable<BaseRenderState["blinkTimer"]>>();
const activeToolTimers = new Set<ReturnType<typeof setInterval>>();
let blinkScheduler: ReturnType<typeof setTimeout> | undefined;

export function isBlinkOn(): boolean {
  return Math.floor(Date.now() / BLINK_INTERVAL_MS) % 2 === 0;
}

export function getStatusSymbol(isDone: boolean, blinkOn: boolean): string {
  if (isDone) return "●";
  return blinkOn ? "●" : "○";
}

export function buildResultStatusParts(
  state: BaseRenderState,
  theme: Theme,
): string[] {
  return state.truncated ? [theme.fg("muted", "truncated")] : [];
}

export function getStatusColor(
  isDone: boolean,
  blinkOn: boolean,
): "success" | "dim" {
  if (!isDone) return blinkOn ? "success" : "dim";
  return "success";
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

  const displayPath = shortenPath(sanitizeDisplayText(rawPath));
  const visiblePath =
    maxWidth === undefined
      ? displayPath
      : truncatePathMiddle(displayPath, maxWidth);
  const styled = theme.fg("accent", visiblePath);
  if (!getCapabilities().hyperlinks) return styled;

  const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  return hyperlink(styled, pathToFileURL(absolutePath).href);
}

function msUntilNextBlinkBoundary(now = Date.now()): number {
  const elapsed = now % BLINK_INTERVAL_MS;
  return elapsed === 0 ? BLINK_INTERVAL_MS : BLINK_INTERVAL_MS - elapsed;
}

function scheduleBlinkTick(): void {
  if (blinkScheduler || activeBlinkTimers.size === 0) return;

  blinkScheduler = setTimeout(() => {
    blinkScheduler = undefined;

    for (const timer of [...activeBlinkTimers]) {
      timer.invalidate();
    }

    scheduleBlinkTick();
  }, msUntilNextBlinkBoundary());
}

export function updateBlinkTimer(
  state: BaseRenderState,
  shouldBlink: boolean,
  invalidate: () => void,
): void {
  if (shouldBlink && !state.blinkTimer) {
    state.blinkTimer = { invalidate };
    activeBlinkTimers.add(state.blinkTimer);
    scheduleBlinkTick();
    return;
  }

  if (!shouldBlink && state.blinkTimer) {
    activeBlinkTimers.delete(state.blinkTimer);
    state.blinkTimer = undefined;

    if (activeBlinkTimers.size === 0 && blinkScheduler) {
      clearTimeout(blinkScheduler);
      blinkScheduler = undefined;
    }
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
  if (blinkScheduler) {
    clearTimeout(blinkScheduler);
    blinkScheduler = undefined;
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

export function sanitizeDisplayText(value: string): string {
  return sanitizeTextOutput(value).replace(/[\n\t]+/g, " ");
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
  return Math.floor(MAX_CALL_WIDTH() / 2);
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
  const hasErrorBody = errorBody.text.length > 0;
  const bodyText = hasErrorBody ? errorBody.text : "error";
  const lines = bodyText.split("\n");

  const formatted = lines
    .map((line, index) => {
      const prefix = index === lines.length - 1 ? "╰─ " : "│  ";
      return formatTreeLine(line, {
        theme,
        prefix,
        width: MAX_CALL_WIDTH() - 1,
        mode: "preserve",
        color: "error",
      }).text;
    })
    .join("\n");

  if (state.truncated) {
    const status = buildResultStatusParts(state, theme).join(
      theme.fg("muted", " • "),
    );
    if (options.expanded) {
      return theme.fg("dim", "├─ ") + status + "\n" + formatted;
    }

    const suffix = errorBody.truncated ? buildHint(theme) : "";
    return (
      theme.fg("dim", "╰─ ") +
      status +
      (hasErrorBody
        ? theme.fg("muted", " • ") + theme.fg("error", bodyText)
        : "") +
      suffix
    );
  }

  if (options.expanded) {
    return formatted;
  }

  const suffix = errorBody.truncated ? buildHint(theme) : "";
  return theme.fg("dim", "╰─ ") + theme.fg("error", bodyText) + suffix;
}

export function formatTreeLine(
  line: string,
  options: {
    theme: Theme;
    prefix: "│  " | "├─ " | "╰─ ";
    width: number;
    mode: "truncate" | "preserve";
    color?: "toolOutput" | "error" | "muted";
  },
): { text: string; truncated: boolean } {
  const { theme, prefix, width, mode, color } = options;
  const contentWidth = Math.max(1, width - visibleWidth(prefix));
  const truncated = mode === "truncate" && visibleWidth(line) > contentWidth;
  const renderedLine = truncated
    ? truncateToWidth(line, contentWidth, theme.fg(color ?? "muted", "..."))
    : line;
  const styledLine =
    color === undefined ? renderedLine : theme.fg(color, renderedLine);

  return {
    text: theme.fg("dim", prefix) + styledLine,
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
  renderOptions?: { paddingX?: number; animate?: boolean },
): { text: Text; prefix: string; isDone: boolean } {
  const text = new TreeText(
    renderOptions?.paddingX ?? 1,
    theme.fg("dim", "│  "),
  );

  const isDone =
    state.hasResult || (!toolCtx.executionStarted && !toolCtx.isPartial);

  // Capture blink phase once so renderCall and renderResult stay in sync
  const animate = renderOptions?.animate ?? true;
  const blinkOn = animate ? isBlinkOn() : false;
  state.blinkOn = blinkOn;

  updateBlinkTimer(state, animate && !isDone, toolCtx.invalidate);

  const prefix = theme.fg(
    getStatusColor(isDone, blinkOn),
    `${getStatusSymbol(isDone, blinkOn)} `,
  );

  return { text, prefix, isDone };
}

function wrapTreeText(
  text: string,
  width: number,
  callContinuationPrefix?: string,
): string {
  if (!text || width <= 3) return text;

  return text
    .split("\n")
    .flatMap((line, sourceLineIndex) => {
      const lineWidth = visibleWidth(line);
      const prefix = sliceByColumn(line, 0, 3);
      const visiblePrefix = stripAnsi(prefix);
      const hasTreePrefix = /^[│├╰][─ ] /u.test(visiblePrefix);

      if (!hasTreePrefix && callContinuationPrefix) {
        const chunks = wrapTextWithAnsi(line, Math.max(1, width - 3));
        return chunks.map((chunk, chunkIndex) =>
          sourceLineIndex === 0 && chunkIndex === 0
            ? chunk
            : callContinuationPrefix + chunk,
        );
      }

      if (lineWidth <= width) return [line];
      if (!hasTreePrefix) return wrapTextWithAnsi(line, width);

      const content = sliceByColumn(line, 3, lineWidth - 3);
      const chunks = wrapTextWithAnsi(content, Math.max(1, width - 3));
      const continuationPrefix = prefix
        .replace("├─ ", "│  ")
        .replace("╰─ ", "│  ");

      return chunks.map((chunk, index) => {
        const isLastChunk = index === chunks.length - 1;
        const chunkPrefix =
          visiblePrefix === "╰─ "
            ? isLastChunk
              ? prefix
              : continuationPrefix
            : index === 0
              ? prefix
              : continuationPrefix;
        return chunkPrefix + chunk;
      });
    })
    .join("\n");
}

class TreeText extends Text {
  private sourceText = "";
  private renderedSource?: string;
  private renderedWidth?: number;

  constructor(
    private readonly horizontalPadding: number,
    private readonly callContinuationPrefix?: string,
  ) {
    super("", horizontalPadding, 0);
  }

  override setText(text: string): void {
    if (text === this.sourceText) return;
    this.sourceText = text;
    this.renderedSource = undefined;
    this.renderedWidth = undefined;
  }

  override render(width: number): string[] {
    if (
      this.renderedSource !== this.sourceText ||
      this.renderedWidth !== width
    ) {
      super.setText(
        wrapTreeText(
          this.sourceText,
          Math.max(1, width - this.horizontalPadding * 2),
          this.callContinuationPrefix,
        ),
      );
      this.renderedSource = this.sourceText;
      this.renderedWidth = width;
    }
    return super.render(width);
  }
}

export function getResultText(
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  lastComponent: unknown,
  renderOptions?: { paddingX?: number },
): Text {
  const paddingX = renderOptions?.paddingX ?? 1;
  const previousText =
    lastComponent instanceof TreeText ? lastComponent : undefined;
  const text =
    state.expanded !== options.expanded || !previousText
      ? new TreeText(paddingX)
      : previousText;

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
  state: ResultStatusState,
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

  // state.truncated is set by buildRenderResult before this runs
  const normalized = normalizeOutput(extractTextContent(result));
  if (normalized === "" || normalized === config.emptyMessage) {
    const emptyParts = buildResultStatusParts(state, theme);
    emptyParts.push(theme.fg("muted", config.emptyMessage));
    return theme.fg("dim", "╰─ ") + emptyParts.join(theme.fg("muted", " • "));
  }

  const items = config.preprocess(normalized);
  const total = items.length;
  const label = total === 1 ? config.singularLabel : config.pluralLabel;

  const summaryParts = buildResultStatusParts(state, theme);
  summaryParts.push(theme.fg("muted", `${total} ${label}`));

  const summary = summaryParts.join(theme.fg("muted", " • "));

  if (!options.expanded) {
    return theme.fg("dim", "╰─ ") + summary + buildHint(theme);
  }

  const visible = items.slice(0, MAX_EXPANDED_ENTRIES());
  const remaining = Math.max(0, total - MAX_EXPANDED_ENTRIES());
  const lines: string[] = [theme.fg("dim", "├─ ") + summary];

  visible.forEach((item, index) => {
    const isLast = index === visible.length - 1 && remaining === 0;
    const prefix: "│  " | "╰─ " = isLast ? "╰─ " : "│  ";
    const rendered = config.renderItem ? config.renderItem(item, theme) : item;
    lines.push(
      formatTreeLine(rendered, {
        theme,
        prefix,
        width: MAX_CALL_WIDTH() - 1,
        mode: "preserve",
        color: "toolOutput",
      }).text,
    );
  });

  if (remaining > 0) {
    lines.push(
      theme.fg("dim", "╰─ ") +
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
    const resultState = state as ResultStatusState;

    invalidateIfChanged(changed, toolCtx.invalidate);
    text.setText(formatFn(result, resultState, options, theme));
    return text;
  };
}
