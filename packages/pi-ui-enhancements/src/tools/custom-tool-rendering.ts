import {
  ExtensionRunner,
  type RegisteredTool,
  type Theme,
  type ToolDefinition,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Handle } from "../types";
import {
  type BaseRenderState,
  MAX_CALL_WIDTH,
  MAX_EXPANDED_ENTRIES,
  buildHint,
  extractTextContent,
  formatSimpleErrorResult,
  formatTreeLine,
  getCallRenderParts,
  getResultSymbolColor,
  getResultText,
  invalidateIfChanged,
  normalizeOutput,
  updateResultState,
} from "./tool-rendering";

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
) {
  if (definition[WRAPPED_TOOL]) return false;
  if (BUILTIN_TOOLS.has(definition.name)) return false;
  if (definition.renderShell === "self") return false;
  return true;
}

function buildGenericCallHeader(
  args: Record<string, unknown>,
  label: string,
  theme: Theme,
): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(args ?? {})) {
    if (value == null) continue;
    if (typeof value === "string" && value.length > 80) continue;
    if (typeof value === "object") continue;
    parts.push(`${key}=${JSON.stringify(value)}`);
  }

  const preview = parts.slice(0, 3).join(" ");
  const raw =
    theme.fg("toolTitle", theme.bold(label)) +
    (preview ? ` ${theme.fg("accent", preview)}` : "");

  return truncateToWidth(raw, MAX_CALL_WIDTH, theme.fg("accent", "..."));
}

function buildGenericResult(
  result: { content: Array<{ type: string; text?: string }> },
  state: BaseRenderState,
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

  const normalized = normalizeOutput(extractTextContent(result));
  if (!normalized) {
    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("muted", "(no output)")
    );
  }

  const hint = buildHint(theme);
  const lines = normalized.split("\n");
  const total = lines.length;
  const summary = `${total} ${total === 1 ? "line" : "lines"}`;

  if (!options.expanded) {
    return (
      theme.fg(getResultSymbolColor(state), "└─ ") +
      theme.fg("toolOutput", summary) +
      hint
    );
  }

  const visible = lines.slice(0, MAX_EXPANDED_ENTRIES);
  const remaining = Math.max(0, total - MAX_EXPANDED_ENTRIES);
  const rendered: string[] = [
    theme.fg(getResultSymbolColor(state), "├─ ") +
      theme.fg("toolOutput", summary),
  ];

  visible.forEach((line, index) => {
    const isLast = index === visible.length - 1 && remaining === 0;
    rendered.push(
      formatTreeLine(line, {
        theme,
        state,
        prefix: isLast ? "└─ " : "│  ",
        width: MAX_CALL_WIDTH - 1,
        mode: "preserve",
      }).text,
    );
  });

  if (remaining > 0) {
    rendered.push(
      theme.fg(getResultSymbolColor(state), "└─ ") +
        theme.fg("muted", `${remaining} more lines`),
    );
  }

  return rendered.join("\n");
}

function wrapDefinition<T extends ToolDefinition>(definition: T): T {
  if (!shouldWrapTool(definition)) return definition;

  const proto = ExtensionRunner.prototype as PatchedRunnerPrototype;
  proto[WRAPPED_DEFINITION_CACHE] ??= new WeakMap();
  const cached = proto[WRAPPED_DEFINITION_CACHE].get(definition);
  if (cached) return cached as T;

  const originalRenderCall = definition.renderCall;
  const originalRenderResult = definition.renderResult;

  const wrapped: ToolDefinition = {
    ...definition,
    [WRAPPED_TOOL]: true,
    renderShell: "self",
    renderCall(args, theme, toolCtx) {
      const state = getCustomState(toolCtx.state);
      const { text, prefix } = getCallRenderParts(state, theme, toolCtx);

      if (originalRenderCall) {
        const inner = originalRenderCall(args, theme, {
          ...toolCtx,
          lastComponent: state.callComponent,
        });
        state.callComponent = inner;

        const innerText = inner
          .render(MAX_CALL_WIDTH)
          .map((line) => line.trimEnd())
          .filter((line) => line.length > 0)
          .join(" ");
        text.setText(
          truncateToWidth(
            prefix + innerText,
            MAX_CALL_WIDTH,
            theme.fg("accent", "..."),
          ),
        );
        return text;
      }

      text.setText(
        prefix +
          buildGenericCallHeader(
            args as Record<string, unknown>,
            definition.label,
            theme,
          ),
      );
      return text;
    },
    renderResult(result, options, theme, toolCtx) {
      const state = getCustomState(toolCtx.state);
      const text = getResultText(state, options, toolCtx.lastComponent);

      const changed = updateResultState(state, {
        isError: toolCtx.isError,
      });
      invalidateIfChanged(changed, toolCtx.invalidate);

      if (!originalRenderResult) {
        text.setText(buildGenericResult(result, state, options, theme));
        return text;
      }

      let inner: Component;
      try {
        inner = originalRenderResult(result, options, theme, {
          ...toolCtx,
          lastComponent: state.resultComponent,
        });
      } catch {
        text.setText(buildGenericResult(result, state, options, theme));
        return text;
      }
      state.resultComponent = inner;

      const innerLines = inner.render(MAX_CALL_WIDTH);
      if (innerLines.length === 0) {
        text.setText(
          state.isError
            ? formatSimpleErrorResult(
                extractTextContent(result),
                state,
                options,
                theme,
              )
            : theme.fg(getResultSymbolColor(state), "└─ ") +
                theme.fg("muted", "(no output)"),
        );
        return text;
      }

      text.setText(
        innerLines
          .map((line, index) => {
            const prefix = index === innerLines.length - 1 ? "└─ " : "│  ";
            return theme.fg(getResultSymbolColor(state), prefix) + line;
          })
          .join("\n"),
      );
      return text;
    },
  };

  proto[WRAPPED_DEFINITION_CACHE].set(definition, wrapped);
  return wrapped as T;
}

function wrapRegisteredTool(tool: RegisteredTool): RegisteredTool {
  const definition = wrapDefinition(tool.definition);
  return definition === tool.definition ? tool : { ...tool, definition };
}

function disposeCustomToolRenderingPatch(): void {
  const current = ExtensionRunner.prototype as PatchedRunnerPrototype;
  const nextRefCount = Math.max(0, (current[PATCH_REF_COUNT] ?? 1) - 1);
  current[PATCH_REF_COUNT] = nextRefCount;

  if (nextRefCount > 0) return;

  if (
    current[ORIGINAL_GET_ALL_TOOLS] &&
    current.getAllRegisteredTools === current[PATCHED_GET_ALL_TOOLS]
  ) {
    current.getAllRegisteredTools = current[ORIGINAL_GET_ALL_TOOLS];
  }
  delete current[ORIGINAL_GET_ALL_TOOLS];
  delete current[PATCHED_GET_ALL_TOOLS];
  delete current[WRAPPED_DEFINITION_CACHE];
  delete current[PATCH_REF_COUNT];
  delete current[PROTOTYPE_PATCHED];
}

export function patchCustomToolRendering(): Handle {
  const proto = ExtensionRunner.prototype as PatchedRunnerPrototype;

  if (proto[PROTOTYPE_PATCHED]) {
    proto[PATCH_REF_COUNT] = (proto[PATCH_REF_COUNT] ?? 1) + 1;
    return {
      dispose() {
        disposeCustomToolRenderingPatch();
      },
    };
  }

  const original = proto.getAllRegisteredTools;
  proto[PROTOTYPE_PATCHED] = true;
  proto[PATCH_REF_COUNT] = 1;
  proto[ORIGINAL_GET_ALL_TOOLS] = original;
  proto[WRAPPED_DEFINITION_CACHE] = new WeakMap();

  const patchedGetAllRegisteredTools =
    function getAllRegisteredToolsWithUiPatch(this: ExtensionRunner) {
      return original.call(this).map(wrapRegisteredTool);
    };
  proto[PATCHED_GET_ALL_TOOLS] = patchedGetAllRegisteredTools;
  proto.getAllRegisteredTools = patchedGetAllRegisteredTools;

  return {
    dispose() {
      disposeCustomToolRenderingPatch();
    },
  };
}
