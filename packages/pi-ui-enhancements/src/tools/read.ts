import {
  type ToolRenderers,
  type ReadToolInput,
} from "@earendil-works/pi-coding-agent";
import { renderReadCall } from "./read/call";
import { formatReadResult } from "./read/result";
import { buildRenderResult } from "./rendering/results";

export function patchReadTool(): ToolRenderers {
  return {
    renderShell: "self",
    renderCall(args, theme, toolContext) {
      return renderReadCall(args as ReadToolInput, theme, toolContext);
    },
    renderResult: buildRenderResult(formatReadResult),
  };
}
