import type {
  BashToolInput,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { renderBashCall } from "./bash/call";
import { formatBashResult } from "./bash/result";
import type { BashDetailsWithTiming, BashRenderState } from "./bash/types";
import {
  invalidateIfChanged,
  registerToolTimer,
  unregisterToolTimer,
  updateResultState,
} from "./rendering/state";
import { getResultText } from "./rendering/tree";

const DURATION_UPDATE_INTERVAL_MS = 250;

export type BashTiming = {
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
};
export type BashTimingLookup = (toolCallId: string) => BashTiming | undefined;

export function patchBashTool(
  getTiming: BashTimingLookup = () => undefined,
): ToolRenderers {
  function updateTiming(state: BashRenderState, toolCallId: string): void {
    const timing = getTiming(toolCallId);
    if (!timing) return;
    if (timing.startedAt !== undefined) state.startedAt = timing.startedAt;
    if (timing.endedAt !== undefined && timing.startedAt !== undefined) {
      state.endedAt = timing.endedAt;
      state.durationMs = timing.endedAt - timing.startedAt;
    }
    if (timing.durationMs !== undefined) state.durationMs = timing.durationMs;
  }

  return {
    renderShell: "self",
    renderCall(args, theme, toolContext) {
      updateTiming(
        toolContext.state as BashRenderState,
        toolContext.toolCallId,
      );
      return renderBashCall(args as BashToolInput, theme, toolContext);
    },
    renderResult(result, options, theme, toolContext) {
      const state = toolContext.state as BashRenderState;
      updateTiming(state, toolContext.toolCallId);
      const text = getResultText(state, options, toolContext.lastComponent);
      const details = result.details as BashDetailsWithTiming | undefined;

      if (
        state.startedAt !== undefined &&
        options.isPartial &&
        !state.durationTimer
      ) {
        state.durationTimer = setInterval(
          () => toolContext.invalidate(),
          DURATION_UPDATE_INTERVAL_MS,
        );
        registerToolTimer(state.durationTimer);
      }

      if (!options.isPartial || toolContext.isError) {
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
        isError: toolContext.isError,
      });
      invalidateIfChanged(changed, toolContext.invalidate);
      text.setText((width) => {
        const previousResultExpandable = state.resultExpandable === true;
        const output = formatBashResult(result, state, options, theme, width);
        invalidateIfChanged(
          previousResultExpandable !== (state.resultExpandable === true),
          toolContext.invalidate,
        );
        return output;
      });
      return text;
    },
  };
}
