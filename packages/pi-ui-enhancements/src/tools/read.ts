import {
  createReadToolDefinition,
  type ExtensionAPI,
  type ReadToolInput,
} from "@earendil-works/pi-coding-agent";
import type { Handle } from "../types";
import { renderReadCall } from "./read/call";
import { formatReadResult } from "./read/result";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";
import { buildRenderResult } from "./tool-rendering";

export function patchReadTool(pi: ExtensionAPI): Handle {
  const tool = createCwdDeferredTool(createReadToolDefinition);

  return registerPatchedTool({
    pi,
    tool,
    renderCall(args, theme, toolContext) {
      return renderReadCall(args as ReadToolInput, theme, toolContext);
    },
    renderResult: buildRenderResult(formatReadResult),
  });
}
