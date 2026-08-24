import {
  ExtensionRunner,
  type RegisteredTool,
  type Theme,
  type ToolDefinition,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { getConfig } from "../config";
import type { Handle } from "../types";
import {
  applyArgumentHyperlinks,
  buildGenericCallHeader,
  capitalizeFirstVisibleChar,
  sanitizeRenderedText,
} from "./custom-rendering/display";
import { buildGenericResult } from "./custom-rendering/result";
import {
  buildResultStatusParts,
  getMaxCallWidth,
  invalidateIfChanged,
  updateResultState,
} from "./rendering/state";
import { extractTextContent, safeTruncateToWidth } from "./rendering/text";
import { formatSimpleErrorResult } from "./rendering/results";
import { getCallRenderParts, getResultText } from "./rendering/tree";
import type { BaseRenderState } from "./rendering/types";

const BUILTIN_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "bash",
  "ls",
  "find",
  "grep",
]);

const PROTOTYPE_PATCHED = Symbol.for("pi-ui-enhancements.prototypePatched");
const ORIGINAL_GET_ALL_TOOLS = Symbol.for(
  "pi-ui-enhancements.originalGetAllTools",
);
const PATCH_REF_COUNT = Symbol.for("pi-ui-enhancements.patchRefCount");
const PATCHED_GET_ALL_TOOLS = Symbol.for(
  "pi-ui-enhancements.patchedGetAllTools",
);
const WRAPPED_TOOL = Symbol.for("pi-ui-enhancements.wrappedTool");
const WRAPPED_DEFINITION_CACHE = Symbol.for(
  "pi-ui-enhancements.wrappedDefinitionCache",
);

type PatchedRunnerPrototype = ExtensionRunner & {
  [PROTOTYPE_PATCHED]?: boolean;
  [ORIGINAL_GET_ALL_TOOLS]?: ExtensionRunner["getAllRegisteredTools"];
  [PATCH_REF_COUNT]?: number;
  [PATCHED_GET_ALL_TOOLS]?: ExtensionRunner["getAllRegisteredTools"];
  [WRAPPED_DEFINITION_CACHE]?: WeakMap<ToolDefinition, ToolDefinition>;
};

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

function shouldWrapTool(
  definition: ToolDefinition & { [WRAPPED_TOOL]?: boolean },
): boolean {
  return (
    !definition[WRAPPED_TOOL] &&
    !BUILTIN_TOOLS.has(definition.name) &&
    definition.renderShell !== "self"
  );
}

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
  isToolCallActive: (toolCallId: string) => boolean,
): NonNullable<ToolDefinition["renderCall"]> {
  return (args, theme, toolContext) => {
    const state = getCustomState(toolContext.state);
    const { text, prefix } = getCallRenderParts(state, theme, toolContext, {
      animate: isToolCallActive(toolContext.toolCallId),
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
      } catch {
        state.callComponent = undefined;
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
  originalRenderResult: ToolDefinition["renderResult"],
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
    } catch {
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

function wrapDefinition<T extends ToolDefinition>(
  definition: T,
  isToolCallActive: (toolCallId: string) => boolean,
): T {
  if (!shouldWrapTool(definition)) return definition;

  const prototype = ExtensionRunner.prototype as PatchedRunnerPrototype;
  prototype[WRAPPED_DEFINITION_CACHE] ??= new WeakMap();
  const cached = prototype[WRAPPED_DEFINITION_CACHE].get(definition);
  if (cached) return cached as T;

  const originalRenderCall = definition.renderCall;
  const originalRenderResult = definition.renderResult;

  const wrapped: ToolDefinition = {
    ...definition,
    [WRAPPED_TOOL]: true,
    renderShell: "self",
    renderCall: createCallRenderer(
      definition,
      originalRenderCall,
      isToolCallActive,
    ),
    renderResult: createResultRenderer(originalRenderResult),
  };

  prototype[WRAPPED_DEFINITION_CACHE].set(definition, wrapped);
  return wrapped as T;
}

function wrapRegisteredTool(
  tool: RegisteredTool,
  isToolCallActive: (toolCallId: string) => boolean,
): RegisteredTool {
  const definition = wrapDefinition(tool.definition, isToolCallActive);
  return definition === tool.definition ? tool : { ...tool, definition };
}

function disposeCustomToolRenderingPatch(): void {
  const prototype = ExtensionRunner.prototype as PatchedRunnerPrototype;
  const nextRefCount = Math.max(0, (prototype[PATCH_REF_COUNT] ?? 1) - 1);
  prototype[PATCH_REF_COUNT] = nextRefCount;

  if (nextRefCount > 0) return;

  if (
    prototype[ORIGINAL_GET_ALL_TOOLS] &&
    prototype.getAllRegisteredTools === prototype[PATCHED_GET_ALL_TOOLS]
  ) {
    prototype.getAllRegisteredTools = prototype[ORIGINAL_GET_ALL_TOOLS];
  }
  delete prototype[ORIGINAL_GET_ALL_TOOLS];
  delete prototype[PATCHED_GET_ALL_TOOLS];
  delete prototype[WRAPPED_DEFINITION_CACHE];
  delete prototype[PATCH_REF_COUNT];
  delete prototype[PROTOTYPE_PATCHED];
}

export function patchCustomToolRendering(
  isToolCallActive: (toolCallId: string) => boolean = () => false,
): Handle {
  const prototype = ExtensionRunner.prototype as PatchedRunnerPrototype;

  if (prototype[PROTOTYPE_PATCHED]) {
    prototype[PATCH_REF_COUNT] = (prototype[PATCH_REF_COUNT] ?? 1) + 1;
    return { dispose: disposeCustomToolRenderingPatch };
  }

  const original = prototype.getAllRegisteredTools;
  if (typeof original !== "function") return { dispose() {} };

  prototype[PROTOTYPE_PATCHED] = true;
  prototype[PATCH_REF_COUNT] = 1;
  prototype[ORIGINAL_GET_ALL_TOOLS] = original;
  prototype[WRAPPED_DEFINITION_CACHE] = new WeakMap();

  const patchedGetAllRegisteredTools =
    function getAllRegisteredToolsWithUiPatch(this: ExtensionRunner) {
      const current = ExtensionRunner.prototype as PatchedRunnerPrototype;
      const tools = original.call(this);
      if ((current[PATCH_REF_COUNT] ?? 0) <= 0 || !Array.isArray(tools)) {
        return tools;
      }
      return tools.map((tool) => wrapRegisteredTool(tool, isToolCallActive));
    };
  prototype[PATCHED_GET_ALL_TOOLS] = patchedGetAllRegisteredTools;
  prototype.getAllRegisteredTools = patchedGetAllRegisteredTools;

  return { dispose: disposeCustomToolRenderingPatch };
}
