import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Handle } from "../types";
import { patchBashTool } from "./bash";
import { patchReadTool } from "./read";
import { patchWriteTool } from "./write";

export function patchTools(pi: ExtensionAPI, ctx: ExtensionContext): Handle[] {
  return [
    patchReadTool(pi, ctx),
    patchWriteTool(pi, ctx),
    patchBashTool(pi, ctx),
  ];
}
