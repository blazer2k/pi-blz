import { keyText, type Theme } from "@earendil-works/pi-coding-agent";
import { getConfig } from "../../config";
import type { BaseRenderState, BlinkIndicator } from "./types";

export function getBlinkIndicator(): BlinkIndicator {
  switch (getConfig().indicatorStyle) {
    case "dot":
      return { unfilled: "◦", filled: "•" };
    case "circle":
      return { unfilled: "○", filled: "●" };
    case "diamond":
      return { unfilled: "◇", filled: "◆" };
  }
}

export const BLINK_INDICATOR = getBlinkIndicator;

export function getMaxCallWidth(): number {
  return getConfig().maxCallWidth;
}

export const MAX_CALL_WIDTH = getMaxCallWidth;

export function getMaxExpandedEntries(): number {
  const value = getConfig().maxExpandedEntries;
  return value === -1 ? Infinity : value;
}

export const MAX_EXPANDED_ENTRIES = getMaxExpandedEntries;

export function getMaxCollapsedLines(): number {
  return getConfig().bashMaxCollapsedLines;
}

export const MAX_COLLAPSED_LINES = getMaxCollapsedLines;

const BLINK_INTERVAL_MS = 500;
const activeBlinkTimers = new Set<NonNullable<BaseRenderState["blinkTimer"]>>();
const activeToolTimers = new Set<ReturnType<typeof setInterval>>();
let blinkScheduler: ReturnType<typeof setTimeout> | undefined;

export function isBlinkOn(): boolean {
  return Math.floor(Date.now() / BLINK_INTERVAL_MS) % 2 === 0;
}

export function getStatusSymbol(isDone: boolean, blinkOn: boolean): string {
  const { filled, unfilled } = getBlinkIndicator();
  return isDone || blinkOn ? filled : unfilled;
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
  return !isDone && !blinkOn ? "dim" : "success";
}

function millisecondsUntilNextBlink(now = Date.now()): number {
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
  }, millisecondsUntilNextBlink());
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

export function buildExpansionHint(
  theme: Theme,
  action: "expand" | "collapse",
  placement: "suffix" | "standalone" = "suffix",
): string {
  if (!getConfig().showExpansionHint) return "";

  const separator = placement === "suffix" ? theme.fg("muted", " • ") : "";
  const shortcut = theme.fg("dim", keyText("app.tools.expand"));
  const description = theme.fg(
    "dim",
    action === "expand" ? " to expand" : " to collapse",
  );
  return separator + shortcut + description;
}

export function buildToolExpansionHint(
  theme: Theme,
  state: BaseRenderState,
  options: { expanded: boolean },
  resultExpandable: boolean,
  placement: "suffix" | "standalone" = "suffix",
): string {
  if (!state.callExpandable && !resultExpandable) return "";
  return buildExpansionHint(
    theme,
    options.expanded ? "collapse" : "expand",
    placement,
  );
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
  if (changed) queueMicrotask(invalidate);
}
