import {
  createBashToolDefinition,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { Handle } from "../types";
import { renderBashCall } from "./bash/call";
import { formatBashResult } from "./bash/result";
import type {
  BashDetailsWithTiming,
  BashRenderState,
  BashToolInput,
} from "./bash/types";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";
import {
  getResultText,
  invalidateIfChanged,
  registerToolTimer,
  unregisterToolTimer,
  updateResultState,
} from "./tool-rendering";

const DURATION_UPDATE_INTERVAL_MS = 250;

export function patchBashTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createBashToolDefinition);
  const failedDurations = new Map<string, number>();

  const registration = registerPatchedTool({
    pi,
    tool,
    async execute(toolCallId, params, signal, onUpdate, context) {
      const startedAt = Date.now();
      try {
        const result = await tool.execute(
          toolCallId,
          params as BashToolInput,
          signal,
          onUpdate,
          context,
        );
        const details = (result.details ?? {}) as BashDetailsWithTiming;

        return {
          ...result,
          details: { ...details, durationMs: Date.now() - startedAt },
        };
      } catch (error) {
        failedDurations.set(toolCallId, Date.now() - startedAt);
        throw error;
      }
    },
    renderCall(args, theme, toolContext) {
      return renderBashCall(args as BashToolInput, theme, toolContext);
    },
    renderResult(result, options, theme, toolContext) {
      const state = toolContext.state as BashRenderState;
      const text = getResultText(state, options, toolContext.lastComponent);
      const details = result.details as BashDetailsWithTiming | undefined;
      const failedDuration = failedDurations.get(toolContext.toolCallId);

      if (failedDuration !== undefined) {
        state.durationMs = failedDuration;
        if (!options.isPartial) failedDurations.delete(toolContext.toolCallId);
      }

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

      text.setText(formatBashResult(result, state, options, theme));
      return text;
    },
  });

  return {
    dispose() {
      failedDurations.clear();
      registration.dispose();
    },
  };
}
