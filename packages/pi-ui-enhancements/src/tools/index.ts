import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Handle } from "../types";
import { patchBashTool } from "./bash";
import { patchLsTool } from "./ls";
import { patchFindTool } from "./find";
import { patchGrepTool } from "./grep";
import { patchReadTool } from "./read";
import { patchWriteTool } from "./write";
import { patchEditTool } from "./edit";

export function patchTools(pi: ExtensionAPI, ctx: ExtensionContext): Handle[] {
  return [
    patchReadTool(pi, ctx),
    patchLsTool(pi, ctx),
    patchFindTool(pi, ctx),
    patchGrepTool(pi, ctx),
    patchWriteTool(pi, ctx),
    patchBashTool(pi, ctx),
    patchEditTool(pi, ctx),
  ];
}
