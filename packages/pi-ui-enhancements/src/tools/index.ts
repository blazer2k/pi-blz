import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Handle } from "../types";
import { patchBashTool } from "./bash";
import { patchLsTool } from "./ls";
import { patchReadTool } from "./read";
import { patchWriteTool } from "./write";
import { patchEditTool } from "./edit";

export function patchTools(pi: ExtensionAPI, ctx: ExtensionContext): Handle[] {
  return [
    patchReadTool(pi, ctx),
    patchLsTool(pi, ctx),
    patchWriteTool(pi, ctx),
    patchBashTool(pi, ctx),
    patchEditTool(pi, ctx),
  ];
}
