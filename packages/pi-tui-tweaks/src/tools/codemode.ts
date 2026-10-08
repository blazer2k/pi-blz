import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { renderCodemodeCall } from "./codemode/call";
import { formatCodemodeResult } from "./codemode/result";
import type { CodemodeRenderState } from "./codemode/types";
import { updateCodemodeTiming } from "./codemode/timing";
import {
  getCustomState,
  WRAPPED_TOOL,
  type DefinitionAdapterOptions,
} from "./custom-tools/definition-adapter";
import { getResultText } from "./rendering/tree";
import { extractTextContent } from "./rendering/text";
import {
  formatCollapsedOutput,
  formatOutputLines,
  selectOutputWindow,
} from "./rendering/output";
import { invalidateIfChanged, updateResultState } from "./rendering/state";

export function createCodemodeRenderers(
  native: ToolRenderers,
  adapterOptions: DefinitionAdapterOptions,
): ToolRenderers & { [WRAPPED_TOOL]: true } {
  return {
    [WRAPPED_TOOL]: true,
    renderShell: "self",
    renderCall(args, theme, context) {
      const state = getCustomState(context.state) as CodemodeRenderState;
      adapterOptions.trackState?.(state);
      const active = adapterOptions.isToolCallActive(context.toolCallId);
      if (active && context.executionStarted && state.hasResult !== true)
        state.startedAt ??= Date.now();
      return renderCodemodeCall(
        native,
        args,
        theme,
        { ...context, state },
        active,
        adapterOptions.reportIssue,
      );
    },
    renderResult(result, options, theme, context) {
      const state = getCustomState(context.state) as CodemodeRenderState;
      const text = getResultText(
        state,
        options,
        context.lastComponent,
        context.outputPad,
      );
      updateCodemodeTiming(
        state,
        options.isPartial,
        context.isError,
        () => adapterOptions.isToolCallActive(context.toolCallId),
        context.invalidate,
      );
      invalidateIfChanged(
        updateResultState(state, {
          hasResult: !options.isPartial,
          isError: context.isError,
        }),
        context.invalidate,
      );
      adapterOptions.trackState?.(state);
      const reportError = (error: unknown) => {
        state.nativeResult = undefined;
        adapterOptions.reportIssue({
          stage: "renderResult",
          toolName: "codemode",
          error,
        });
      };
      let nativeResult: CodemodeRenderState["nativeResult"];
      if (options.expanded && native.renderResult) {
        try {
          nativeResult = native.renderResult(result, options, theme, {
            ...context,
            lastComponent: state.nativeResult,
          });
          state.nativeResult = nativeResult;
        } catch (error) {
          reportError(error);
        }
      }
      text.setText((width) => {
        const previous = state.resultExpandable === true;
        try {
          let nativeLines: string[] | undefined;
          if (options.expanded) {
            try {
              nativeLines = nativeResult?.render(Math.max(1, width - 3));
            } catch (error) {
              reportError(error);
            }
            nativeLines ??= extractTextContent(result).split("\n");
          }
          const output = formatCodemodeResult(
            result,
            state,
            options,
            theme,
            width,
            nativeLines,
            context.cwd,
          );
          invalidateIfChanged(
            previous !== (state.resultExpandable === true),
            context.invalidate,
          );
          return output;
        } catch (error) {
          reportError(error);
          const output = extractTextContent(result);
          const color = context.isError ? "error" : "toolOutput";
          return options.expanded
            ? formatOutputLines(output, theme, color).text
            : formatCollapsedOutput(
                selectOutputWindow(output, "preview"),
                theme,
                color,
                width,
              ).text;
        }
      }, nativeResult);
      return text;
    },
  };
}
