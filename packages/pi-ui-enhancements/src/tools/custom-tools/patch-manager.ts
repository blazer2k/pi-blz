import {
  ExtensionRunner,
  type RegisteredTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Handle } from "../../shared/handle";
import {
  createWrappedDefinition,
  shouldWrapDefinition,
} from "./definition-adapter";
import type {
  CustomToolRenderingIssue,
  CustomToolRenderingReporter,
} from "./types";

const PATCH_STATE = Symbol.for(
  "@blazer2k/pi-ui-enhancements/custom-tools/patch-state/v1",
);

type PatchClient = {
  isToolCallActive: (toolCallId: string) => boolean;
  reportIssue: CustomToolRenderingReporter;
};

type PatchState = {
  originalDescriptor: PropertyDescriptor;
  original: ExtensionRunner["getAllRegisteredTools"];
  patched: ExtensionRunner["getAllRegisteredTools"];
  clients: Map<symbol, PatchClient>;
  definitions: WeakMap<ToolDefinition, ToolDefinition>;
  reportedPatchIssues: Set<CustomToolRenderingIssue["stage"]>;
  reportedDefinitionIssues: WeakMap<
    ToolDefinition,
    Set<CustomToolRenderingIssue["stage"]>
  >;
};

type PatchedRunnerPrototype = ExtensionRunner & {
  [PATCH_STATE]?: PatchState;
};

const NOOP_HANDLE: Handle = { dispose() {} };

function defaultReporter(issue: CustomToolRenderingIssue): void {
  const tool = issue.toolName ? ` for ${issue.toolName}` : "";
  console.warn(
    `[pi-ui-enhancements] Custom tool rendering ${issue.stage} failed${tool}; continuing without that enhancement.`,
    issue.error,
  );
}

function notifyReporter(
  reporter: CustomToolRenderingReporter,
  issue: CustomToolRenderingIssue,
): void {
  try {
    reporter(issue);
  } catch {
    // Diagnostics must never interfere with tool rendering.
  }
}

function reportIssue(
  state: PatchState,
  issue: CustomToolRenderingIssue,
  definition?: ToolDefinition,
): void {
  if (definition) {
    let stages = state.reportedDefinitionIssues.get(definition);
    if (!stages) {
      stages = new Set();
      state.reportedDefinitionIssues.set(definition, stages);
    }
    if (stages.has(issue.stage)) return;
    stages.add(issue.stage);
  } else {
    if (state.reportedPatchIssues.has(issue.stage)) return;
    state.reportedPatchIssues.add(issue.stage);
  }

  const client = state.clients.values().next().value as PatchClient | undefined;
  if (client) notifyReporter(client.reportIssue, issue);
}

function isAnyToolCallActive(
  state: PatchState,
  definition: ToolDefinition,
  toolCallId: string,
): boolean {
  for (const client of state.clients.values()) {
    try {
      if (client.isToolCallActive(toolCallId)) return true;
    } catch (error) {
      reportIssue(
        state,
        { stage: "activity", toolName: definition.name, error },
        definition,
      );
    }
  }
  return false;
}

function wrapDefinition<T extends ToolDefinition>(
  state: PatchState,
  definition: T,
): T {
  if (!shouldWrapDefinition(definition)) return definition;

  const cached = state.definitions.get(definition);
  if (cached) return cached as T;

  const wrapped = createWrappedDefinition(definition, {
    isToolCallActive: (toolCallId) =>
      isAnyToolCallActive(state, definition, toolCallId),
    reportIssue: (issue) => reportIssue(state, issue, definition),
  });
  state.definitions.set(definition, wrapped);
  return wrapped;
}

function isRegisteredTool(value: unknown): value is RegisteredTool {
  if (!value || typeof value !== "object") return false;
  const definition = (value as { definition?: unknown }).definition;
  return (
    Boolean(definition) &&
    typeof definition === "object" &&
    typeof (definition as { name?: unknown }).name === "string"
  );
}

function wrapRegisteredTool(
  state: PatchState,
  value: unknown,
): RegisteredTool | unknown {
  if (!isRegisteredTool(value)) {
    reportIssue(state, {
      stage: "definition",
      error: new TypeError("Pi returned an invalid registered tool"),
    });
    return value;
  }

  try {
    const definition = wrapDefinition(state, value.definition);
    return definition === value.definition ? value : { ...value, definition };
  } catch (error) {
    reportIssue(
      state,
      { stage: "definition", toolName: value.definition.name, error },
      value.definition,
    );
    return value;
  }
}

function createPatchState(
  prototype: PatchedRunnerPrototype,
  reporter: CustomToolRenderingReporter,
): PatchState | undefined {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    prototype,
    "getAllRegisteredTools",
  );
  const original = originalDescriptor?.value;

  if (
    !originalDescriptor ||
    typeof original !== "function" ||
    (!originalDescriptor.configurable && !originalDescriptor.writable)
  ) {
    notifyReporter(reporter, {
      stage: "install",
      error: new TypeError(
        "ExtensionRunner.getAllRegisteredTools cannot be safely patched",
      ),
    });
    return undefined;
  }

  const state: PatchState = {
    originalDescriptor,
    original,
    patched: original,
    clients: new Map(),
    definitions: new WeakMap(),
    reportedPatchIssues: new Set(),
    reportedDefinitionIssues: new WeakMap(),
  };

  state.patched = function getAllRegisteredToolsWithUiPatch(
    this: ExtensionRunner,
  ) {
    let tools: ReturnType<ExtensionRunner["getAllRegisteredTools"]>;
    try {
      tools = state.original.call(this);
    } catch (error) {
      reportIssue(state, { stage: "registry", error });
      throw error;
    }

    if (state.clients.size === 0) return tools;
    if (!Array.isArray(tools)) {
      reportIssue(state, {
        stage: "registry",
        error: new TypeError("Pi returned a non-array tool registry"),
      });
      return tools;
    }

    return tools.map((tool) => wrapRegisteredTool(state, tool));
  } as ExtensionRunner["getAllRegisteredTools"];

  try {
    Object.defineProperty(prototype, PATCH_STATE, {
      configurable: true,
      value: state,
    });
    Object.defineProperty(prototype, "getAllRegisteredTools", {
      ...originalDescriptor,
      value: state.patched,
    });
  } catch (error) {
    delete prototype[PATCH_STATE];
    notifyReporter(reporter, { stage: "install", error });
    return undefined;
  }

  return state;
}

function getOrCreatePatchState(
  prototype: PatchedRunnerPrototype,
  reporter: CustomToolRenderingReporter,
): PatchState | undefined {
  const existing = prototype[PATCH_STATE];
  if (!existing) return createPatchState(prototype, reporter);

  if (
    existing.clients.size === 0 &&
    prototype.getAllRegisteredTools === existing.original
  ) {
    delete prototype[PATCH_STATE];
    return createPatchState(prototype, reporter);
  }

  return existing;
}

function deactivatePatch(
  prototype: PatchedRunnerPrototype,
  state: PatchState,
  reporter: CustomToolRenderingReporter,
): void {
  if (state.clients.size > 0) return;

  if (prototype.getAllRegisteredTools === state.patched) {
    try {
      Object.defineProperty(
        prototype,
        "getAllRegisteredTools",
        state.originalDescriptor,
      );
      delete prototype[PATCH_STATE];
    } catch (error) {
      notifyReporter(reporter, { stage: "install", error });
    }
  }
}

export function patchCustomToolRendering(
  isToolCallActive: (toolCallId: string) => boolean = () => false,
  reporter: CustomToolRenderingReporter = defaultReporter,
): Handle {
  const prototype = ExtensionRunner.prototype as PatchedRunnerPrototype;
  const state = getOrCreatePatchState(prototype, reporter);
  if (!state) return NOOP_HANDLE;

  const token = Symbol("custom-tool-rendering-client");
  state.clients.set(token, { isToolCallActive, reportIssue: reporter });

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      state.clients.delete(token);
      deactivatePatch(prototype, state, reporter);
    },
  };
}
