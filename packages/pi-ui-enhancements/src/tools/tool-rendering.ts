import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { keyHint, Theme } from "@earendil-works/pi-coding-agent";
import { getCapabilities, hyperlink } from "@earendil-works/pi-tui";

export type BaseRenderState = {
  blinkTimer?: ReturnType<typeof setInterval>;
  hasResult?: boolean;
  truncated?: boolean;
  isError?: boolean;
  expanded?: boolean;
};

export const MAX_CALL_WIDTH = 120;

const BLINK_INTERVAL_MS = 500;
const activeBlinkTimers = new Set<ReturnType<typeof setInterval>>();

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

export function renderPath(
  rawPath: unknown,
  theme: Theme,
  cwd: string,
): string {
  if (rawPath == null || rawPath === "") return theme.fg("toolOutput", "...");
  if (typeof rawPath !== "string") return theme.fg("error", "[invalid arg]");

  const styled = theme.fg("accent", shortenPath(rawPath));
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

export function clearBlinkTimers(): void {
  for (const timer of activeBlinkTimers) {
    clearInterval(timer);
  }
  activeBlinkTimers.clear();
}

export function countLines(text: string): number {
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

export function buildHint(theme: Theme): string {
  return (
    theme.fg("muted", " (") +
    keyHint("app.tools.expand", "to expand") +
    theme.fg("muted", ")")
  );
}
