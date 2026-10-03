import {
  highlightCode,
  type ToolDefinition,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatToolLabel } from "../rendering/labels";
import { getBlinkIndicator, invalidateIfChanged } from "../rendering/state";
import {
  safeTruncateToWidth,
  sanitizeMultilineDisplayText,
} from "../rendering/text";
import { getCallPrefix, getCallText } from "../rendering/tree";
import type { CodemodeRenderState } from "./types";
import type { CustomToolRenderingReporter } from "../custom-tools/types";

export function renderCodemodeCall(
  native: ToolDefinition<any, any, any>,
  args: unknown,
  theme: Theme,
  context: Parameters<NonNullable<ToolDefinition["renderCall"]>>[2],
  active: boolean,
  reportIssue: CustomToolRenderingReporter,
) {
  const state = context.state as CodemodeRenderState;
  const reportError = (error: unknown) => {
    state.nativeCall = undefined;
    reportIssue({ stage: "renderCall", toolName: native.name, error });
  };
  const code = (args as { code?: unknown } | undefined)?.code;
  const source =
    typeof code === "string" ? sanitizeMultilineDisplayText(code) : "...";
  const colors = theme.colors;
  if (
    state.hasResult === true ||
    state.callHighlightCache?.source !== source ||
    state.callHighlightCache.colors !== colors
  ) {
    state.callHighlightCache = {
      source,
      colors,
      preview: highlightCode(source.split("\n")[0] ?? "", "javascript").join(
        "\n",
      ),
    };
  }
  const preview = state.callHighlightCache.preview;
  const text = getCallText(theme);
  let nativeCall: CodemodeRenderState["nativeCall"];
  if (context.expanded) {
    try {
      nativeCall = native.renderCall!(args, theme, {
        ...context,
        lastComponent: state.nativeCall,
      });
      state.nativeCall = nativeCall;
    } catch (error) {
      reportError(error);
    }
  }
  text.setText((width) => {
    const label = formatToolLabel("codemode");
    const title = theme.fg("toolTitle", theme.bold(label));
    const callWidth = Math.max(1, width - 3);
    const expandable =
      source.includes("\n") ||
      visibleWidth(`${getBlinkIndicator().filled} ${label} ${source}`) >
        callWidth;
    const changed = (state.callExpandable === true) !== expandable;
    state.callExpandable = expandable;
    invalidateIfChanged(changed, context.invalidate);
    const expanded =
      context.expanded && (expandable || state.resultExpandable === true);
    const { prefix } = getCallPrefix(state, theme, context, {
      animate: active || (!context.executionStarted && context.isPartial),
      staticActive: expanded,
    });
    if (expanded) {
      if (nativeCall) {
        try {
          const rows = nativeCall.render(Math.max(label.length, callWidth));
          return (
            prefix +
            title +
            rows
              .slice(1)
              .map((line) => `\n${line}`)
              .join("")
          );
        } catch (error) {
          reportError(error);
        }
      }
      return (
        prefix + title + "\n" + highlightCode(source, "javascript").join("\n")
      );
    }
    return safeTruncateToWidth(
      prefix + title + " " + preview,
      callWidth,
      theme.fg("dim", "..."),
    );
  }, nativeCall);
  return text;
}
