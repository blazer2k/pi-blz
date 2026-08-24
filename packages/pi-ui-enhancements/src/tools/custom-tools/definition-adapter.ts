import type {
  Theme,
  ToolDefinition,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { getConfig } from "../../config/store";
import {
  buildResultStatusParts,
  getMaxCallWidth,
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
  capitalizeFirstVisibleChar,
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

function getCustomState(state: unknown): CustomRenderState {
  const root = state as StateWithCustom;
  root._uiEnhancements ??= {};
  return root._uiEnhancements;
}

export function shouldWrapDefinition(
  definition: ToolDefinition & { [WRAPPED_TOOL]?: boolean },
): boolean {
  return !definition[WRAPPED_TOOL] && definition.renderShell !== "self";
}

type DefinitionAdapterOptions = {
  isToolCallActive: (toolCallId: string) => boolean;
  reportIssue: CustomToolRenderingReporter;
};

function renderComponentLines(component: Component): string[] {
  return component
    .render(getMaxCallWidth())
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function formatEmptyResult(
  result: { content: Array<{ type: string; text?: string }> },
  state: CustomRenderState,
  options: ToolRenderResultOptions,
  theme: Theme,
): string {
  if (state.isError) {
    return formatSimpleErrorResult(
      extractTextContent(result),
      state,
      options,
      theme,
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
    const config = getConfig();
    const maxWidth = getMaxCallWidth();

    if (originalRenderCall) {
      try {
        const component = originalRenderCall(args, theme, {
          ...toolContext,
          lastComponent: state.callComponent,
        });
        state.callComponent = component;

        let innerText = sanitizeRenderedText(
          renderComponentLines(component).join(" "),
        );
        if (config.capitalizeToolNames) {
          innerText = capitalizeFirstVisibleChar(innerText);
        }
        innerText = applyArgumentHyperlinks(innerText, args, toolContext.cwd);
        text.setText(
          safeTruncateToWidth(
            prefix + innerText,
            maxWidth,
            theme.fg("accent", "..."),
          ),
        );
        return text;
      } catch (error) {
        state.callComponent = undefined;
        options.reportIssue({
          stage: "renderCall",
          toolName: definition.name,
          error,
        });
      }
    }

    const label =
      config.capitalizeToolNames && definition.label
        ? capitalizeFirstVisibleChar(definition.label)
        : definition.label;
    const header = buildGenericCallHeader(
      args as Record<string, unknown>,
      label,
      theme,
    );
    text.setText(
      safeTruncateToWidth(prefix + header, maxWidth, theme.fg("accent", "...")),
    );
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
      truncated: details?.truncation?.truncated === true,
      isError: toolContext.isError,
    });
    invalidateIfChanged(changed, toolContext.invalidate);

    if (!originalRenderResult) {
      text.setText(buildGenericResult(result, state, options, theme));
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
      text.setText(buildGenericResult(result, state, options, theme));
      return text;
    }
    state.resultComponent = component;

    const innerLines = renderComponentLines(component);
    if (innerLines.length === 0) {
      text.setText(formatEmptyResult(result, state, options, theme));
      return text;
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
    text.setText(renderedLines.join("\n"));
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
