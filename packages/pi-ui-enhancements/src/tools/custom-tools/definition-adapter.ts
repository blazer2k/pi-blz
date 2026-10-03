import type {
  Theme,
  ToolDefinition,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { formatToolLabel } from "../rendering/labels";
import {
  buildResultStatusParts,
  invalidateIfChanged,
  updateResultState,
} from "../rendering/state";
import { formatSimpleErrorResult } from "../rendering/results";
import { extractTextContent, safeTruncateToWidth } from "../rendering/text";
import { getCallRenderParts, getResultText } from "../rendering/tree";
import type { BaseRenderState } from "../rendering/types";
import {
  applyArgumentHyperlinks,
  buildGenericCallHeader,
  sanitizeRenderedText,
} from "./display";
import { buildGenericResult } from "./result";
import type { CustomToolRenderingReporter } from "./types";

export const WRAPPED_TOOL = Symbol.for(
  "@blazer2k/pi-ui-enhancements/custom-tools/wrapped/v1",
);

type CustomRenderState = BaseRenderState & {
  callComponent?: Component;
  resultComponent?: Component;
};

type StateWithCustom = {
  _uiEnhancements?: CustomRenderState;
};

export function getCustomState(state: unknown): CustomRenderState {
  const root = state as StateWithCustom;
  root._uiEnhancements ??= {};
  return root._uiEnhancements;
}

export function shouldWrapDefinition(
  definition: ToolDefinition & { [WRAPPED_TOOL]?: boolean },
): boolean {
  return !definition[WRAPPED_TOOL] && definition.renderShell !== "self";
}

export type DefinitionAdapterOptions = {
  isToolCallActive: (toolCallId: string) => boolean;
  reportIssue: CustomToolRenderingReporter;
};

function renderComponentLines(
  component: Component,
  width: number,
  preserveBlankLines = false,
): string[] {
  const lines = component.render(width).map((line) => line.trimEnd());
  return preserveBlankLines ? lines : lines.filter((line) => line.length > 0);
}

function formatEmptyResult(
  result: { content: Array<{ type: string; text?: string }> },
  state: CustomRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
  width: number,
): string {
  if (state.isError) {
    return formatSimpleErrorResult(
      extractTextContent(result),
      state,
      options,
      theme,
      width,
    );
  }

  const metadata = buildResultStatusParts(state, theme);
  metadata.push(theme.fg("muted", "(no output)"));
  return theme.fg("dim", "╰─ ") + metadata.join(theme.fg("muted", " • "));
}

function createCallRenderer(
  definition: ToolDefinition,
  originalRenderCall: ToolDefinition["renderCall"],
  options: DefinitionAdapterOptions,
): NonNullable<ToolDefinition["renderCall"]> {
  return (args, theme, toolContext) => {
    const state = getCustomState(toolContext.state);
    const { text, prefix } = getCallRenderParts(state, theme, toolContext, {
      animate: options.isToolCallActive(toolContext.toolCallId),
    });
    const renderFallback = (width: number): string => {
      const label = formatToolLabel(definition.label);
      const header = buildGenericCallHeader(
        args as Record<string, unknown>,
        label,
        theme,
      );
      return safeTruncateToWidth(
        prefix + header,
        width,
        theme.fg("accent", "..."),
      );
    };
    const reportError = (error: unknown): void => {
      state.callComponent = undefined;
      options.reportIssue({
        stage: "renderCall",
        toolName: definition.name,
        error,
      });
    };

    if (originalRenderCall) {
      try {
        const component = originalRenderCall(args, theme, {
          ...toolContext,
          lastComponent: state.callComponent,
        });
        state.callComponent = component;

        text.setText((width) => {
          const nativeWidth = Math.max(1, width - 3);
          try {
            const lines = renderComponentLines(
              component,
              nativeWidth,
              toolContext.expanded,
            );
            let innerText = toolContext.expanded
              ? lines.map(sanitizeRenderedText).join("\n")
              : sanitizeRenderedText(lines.join(" "));
            innerText = formatToolLabel(innerText);
            innerText = applyArgumentHyperlinks(
              innerText,
              args,
              toolContext.cwd,
            );
            return toolContext.expanded
              ? prefix + innerText
              : safeTruncateToWidth(
                  prefix + innerText,
                  nativeWidth,
                  theme.fg("accent", "..."),
                );
          } catch (error) {
            reportError(error);
            return renderFallback(nativeWidth);
          }
        }, component);
        return text;
      } catch (error) {
        reportError(error);
      }
    }

    text.setText((width) => renderFallback(Math.max(1, width - 3)));
    return text;
  };
}

function createResultRenderer(
  definition: ToolDefinition,
  originalRenderResult: ToolDefinition["renderResult"],
  reportIssue: CustomToolRenderingReporter,
): NonNullable<ToolDefinition["renderResult"]> {
  return (result, options, theme, toolContext) => {
    const state = getCustomState(toolContext.state);
    const text = getResultText(state, options, toolContext.lastComponent);
    const details = result.details as
      | { truncation?: { truncated?: boolean } }
      | undefined;
    const changed = updateResultState(state, {
      hasResult: !options.isPartial,
      truncated: details?.truncation?.truncated === true,
      isError: toolContext.isError,
    });
    invalidateIfChanged(changed, toolContext.invalidate);

    if (!originalRenderResult) {
      text.setText((width) =>
        buildGenericResult(result, state, options, theme, width),
      );
      return text;
    }

    let component: Component;
    try {
      component = originalRenderResult(result, options, theme, {
        ...toolContext,
        lastComponent: state.resultComponent,
      });
    } catch (error) {
      reportIssue({
        stage: "renderResult",
        toolName: definition.name,
        error,
      });
      text.setText((width) =>
        buildGenericResult(result, state, options, theme, width),
      );
      return text;
    }
    state.resultComponent = component;

    text.setText((width) => {
      try {
        const innerLines = renderComponentLines(
          component,
          Math.max(1, width - 3),
        );
        if (innerLines.length === 0) {
          return formatEmptyResult(result, state, options, theme, width);
        }

        const renderedLines = innerLines.map((line, index) => {
          const prefix = index === innerLines.length - 1 ? "╰─ " : "│  ";
          return theme.fg("dim", prefix) + line;
        });
        if (state.truncated) {
          const status = buildResultStatusParts(state, theme).join(
            theme.fg("muted", " • "),
          );
          renderedLines.unshift(theme.fg("dim", "├─ ") + status);
        }
        return renderedLines.join("\n");
      } catch (error) {
        reportIssue({
          stage: "renderResult",
          toolName: definition.name,
          error,
        });
        return buildGenericResult(result, state, options, theme, width);
      }
    }, component);
    return text;
  };
}

export function createWrappedDefinition<T extends ToolDefinition>(
  definition: T,
  options: DefinitionAdapterOptions,
): T {
  return {
    ...definition,
    [WRAPPED_TOOL]: true,
    renderShell: "self",
    renderCall: createCallRenderer(definition, definition.renderCall, options),
    renderResult: createResultRenderer(
      definition,
      definition.renderResult,
      options.reportIssue,
    ),
  } as T;
}
