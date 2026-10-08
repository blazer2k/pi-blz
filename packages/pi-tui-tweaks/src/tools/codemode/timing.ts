import {
  registerToolTimer,
  unregisterToolTimer,
  updateBlinkTimer,
} from "../rendering/state";
import type { CodemodeRenderState } from "./types";

function stopTiming(state: CodemodeRenderState): void {
  if (state.startedAt !== undefined) state.endedAt ??= Date.now();
  if (state.durationTimer) {
    clearInterval(state.durationTimer);
    unregisterToolTimer(state.durationTimer);
    state.durationTimer = undefined;
  }
  if (state.blinkTimer)
    updateBlinkTimer(state, false, state.blinkTimer.invalidate);
}

export function clearCodemodeTimers(
  states: Iterable<CodemodeRenderState>,
): void {
  for (const state of states) stopTiming(state);
}

export function updateCodemodeTiming(
  state: CodemodeRenderState,
  isPartial: boolean,
  isError: boolean,
  isActive: () => boolean,
  invalidate: () => void,
): void {
  if (!isPartial || isError || !isActive()) {
    stopTiming(state);
  } else if (state.startedAt !== undefined && !state.durationTimer) {
    state.endedAt = undefined;
    state.durationTimer = setInterval(() => {
      if (!isActive()) stopTiming(state);
      invalidate();
    }, 250);
    registerToolTimer(state.durationTimer);
  }
}
