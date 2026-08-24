import {
  ExtensionRunner,
  type RegisteredTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Handle } from "../../types";
import { createWrappedDefinition, shouldWrapDefinition } from "./definition";

const PROTOTYPE_PATCHED = Symbol.for("pi-ui-enhancements.prototypePatched");
const ORIGINAL_GET_ALL_TOOLS = Symbol.for(
  "pi-ui-enhancements.originalGetAllTools",
);
const PATCH_REF_COUNT = Symbol.for("pi-ui-enhancements.patchRefCount");
const PATCHED_GET_ALL_TOOLS = Symbol.for(
  "pi-ui-enhancements.patchedGetAllTools",
);
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

function wrapDefinition<T extends ToolDefinition>(
  prototype: PatchedRunnerPrototype,
  definition: T,
  isToolCallActive: (toolCallId: string) => boolean,
): T {
  if (!shouldWrapDefinition(definition)) return definition;

  prototype[WRAPPED_DEFINITION_CACHE] ??= new WeakMap();
  const cached = prototype[WRAPPED_DEFINITION_CACHE].get(definition);
  if (cached) return cached as T;

  const wrapped = createWrappedDefinition(definition, isToolCallActive);
  prototype[WRAPPED_DEFINITION_CACHE].set(definition, wrapped);
  return wrapped;
}

function wrapRegisteredTool(
  prototype: PatchedRunnerPrototype,
  tool: RegisteredTool,
  isToolCallActive: (toolCallId: string) => boolean,
): RegisteredTool {
  const definition = wrapDefinition(
    prototype,
    tool.definition,
    isToolCallActive,
  );
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
      return tools.map((tool) =>
        wrapRegisteredTool(current, tool, isToolCallActive),
      );
    };
  prototype[PATCHED_GET_ALL_TOOLS] = patchedGetAllRegisteredTools;
  prototype.getAllRegisteredTools = patchedGetAllRegisteredTools;

  return { dispose: disposeCustomToolRenderingPatch };
}
