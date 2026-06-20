import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ExtensionRunner,
  type RegisteredTool,
  type Theme,
  type ToolDefinition,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  hyperlink,
  type Component,
} from "@earendil-works/pi-tui";
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
  safeTruncateToWidth,
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
const MIN_LINK_PREFIX_LENGTH = 24;

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

  return safeTruncateToWidth(raw, MAX_CALL_WIDTH, theme.fg("accent", "..."));
}

type LinkTarget = {
  display: string;
  url: string;
};

function collectStringValues(
  value: unknown,
  output: Set<string>,
  depth = 0,
): void {
  if (depth > 5 || value == null) return;

  if (typeof value === "string") {
    output.add(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output, depth + 1);
    return;
  }

  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStringValues(item, output, depth + 1);
    }
  }
}

function getUrlTarget(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:", "file:"].includes(url.protocol)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function getPathTarget(value: string, cwd: string): string | undefined {
  if (/\s/.test(value)) return undefined;

  const expanded = value.startsWith("~/")
    ? resolve(homedir(), value.slice(2))
    : value;

  if (isAbsolute(expanded)) return pathToFileURL(expanded).href;
  if (value.startsWith("./") || value.startsWith("../")) {
    return pathToFileURL(resolve(cwd, value)).href;
  }

  return undefined;
}

function getLinkTargets(args: unknown, cwd: string): LinkTarget[] {
  const values = new Set<string>();
  collectStringValues(args, values);

  return [...values]
    .map((display) => {
      const url = getUrlTarget(display) ?? getPathTarget(display, cwd);
      return url ? { display, url } : undefined;
    })
    .filter((target): target is LinkTarget => target !== undefined)
    .sort((a, b) => b.display.length - a.display.length);
}

function getLongestVisibleTargetPrefix(
  text: string,
  target: LinkTarget,
): string | undefined {
  const maxLength = Math.min(target.display.length, text.length);

  for (let length = maxLength; length >= MIN_LINK_PREFIX_LENGTH; length--) {
    const prefix = target.display.slice(0, length);
    if (text.includes(prefix)) return prefix;
  }

  return undefined;
}

type LinkReplacement = {
  start: number;
  end: number;
  display: string;
  url: string;
};

function overlapsExistingReplacement(
  replacements: LinkReplacement[],
  start: number,
  end: number,
): boolean {
  return replacements.some(
    (replacement) => start < replacement.end && end > replacement.start,
  );
}

function applyArgumentHyperlinks(
  text: string,
  args: unknown,
  cwd: string,
): string {
  if (!getCapabilities().hyperlinks || text.includes("\u001B]8;")) return text;

  const replacements: LinkReplacement[] = [];

  for (const target of getLinkTargets(args, cwd)) {
    const display = text.includes(target.display)
      ? target.display
      : getLongestVisibleTargetPrefix(text, target);

    if (!display) continue;

    const start = text.indexOf(display);
    const end = start + display.length;
    if (start === -1 || overlapsExistingReplacement(replacements, start, end)) {
      continue;
    }

    replacements.push({ start, end, display, url: target.url });
  }

  if (replacements.length === 0) return text;

  replacements.sort((a, b) => a.start - b.start);

  let linked = "";
  let cursor = 0;
  for (const replacement of replacements) {
    linked += text.slice(cursor, replacement.start);
    linked += hyperlink(replacement.display, replacement.url);
    cursor = replacement.end;
  }
  linked += text.slice(cursor);

  return linked;
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
        const linkedInnerText = applyArgumentHyperlinks(
          innerText,
          args,
          toolCtx.cwd,
        );
        text.setText(
          safeTruncateToWidth(
            prefix + linkedInnerText,
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
