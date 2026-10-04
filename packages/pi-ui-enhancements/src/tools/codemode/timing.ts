import {
  registerToolTimer,
  unregisterToolTimer,
  updateBlinkTimer,
} from "../rendering/state";
import type { CodemodeRenderState } from "./types";

const activeStates = new Set<CodemodeRenderState>();

function stopTiming(state: CodemodeRenderState): void {
  if (state.startedAt !== undefined) state.endedAt ??= Date.now();
  if (state.durationTimer) {
    clearInterval(state.durationTimer);
    unregisterToolTimer(state.durationTimer);
    state.durationTimer = undefined;
  }
  if (state.blinkTimer)
    updateBlinkTimer(state, false, state.blinkTimer.invalidate);
  activeStates.delete(state);
}

export function clearCodemodeTimers(
  states: Iterable<CodemodeRenderState> = activeStates,
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
    activeStates.add(state);
    registerToolTimer(state.durationTimer);
  }
}
