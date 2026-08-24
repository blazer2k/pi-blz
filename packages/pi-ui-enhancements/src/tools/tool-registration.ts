import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Handle } from "../types";
import { clearBlinkTimers } from "./rendering/state";

// Loose tool type: concrete tool definitions (with their own parameter,
// details, and state generics) are all assignable to it, while any remains
// bidirectional so renderers and execute keep working through it.
type AnyToolDefinition = ToolDefinition<any, any, any>;

export function createCwdDeferredTool(
  createTool: (cwd: string) => AnyToolDefinition,
): AnyToolDefinition {
  const meta = createTool(process.cwd());
  const execute: NonNullable<AnyToolDefinition["execute"]> = (
    toolCallId,
    params,
    signal,
    onUpdate,
    ctx,
  ) => createTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);

  return { ...meta, execute };
}

/**
 * Re-register a native tool with custom rendering. All native properties
 * (description, parameters, prompt metadata, constrained sampling, ...) are
 * kept as-is; only the renderers, and optionally execute, are replaced.
 */
export function registerPatchedTool(config: {
  pi: ExtensionAPI;
  tool: AnyToolDefinition;
  execute?: AnyToolDefinition["execute"];
  renderCall: NonNullable<AnyToolDefinition["renderCall"]>;
  renderResult: NonNullable<AnyToolDefinition["renderResult"]>;
}): Handle {
  config.pi.registerTool({
    ...config.tool,
    renderShell: "self",
    execute: config.execute ?? config.tool.execute,
    renderCall: config.renderCall,
    renderResult: config.renderResult,
  });

  return {
    dispose() {
      clearBlinkTimers();
    },
  };
}
