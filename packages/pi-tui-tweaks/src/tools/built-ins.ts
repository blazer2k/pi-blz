import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { patchBashTool } from "./bash";
import { patchLsTool } from "./ls";
import { patchFindTool } from "./find";
import { patchGrepTool } from "./grep";
import { patchReadTool } from "./read";
import { patchWriteTool } from "./write";
import { patchEditTool } from "./edit";

export function patchTools(): ReadonlyMap<string, ToolRenderers> {
  return new Map([
    ["read", patchReadTool()],
    ["write", patchWriteTool()],
    ["edit", patchEditTool()],
    ["bash", patchBashTool()],
    ["ls", patchLsTool()],
    ["find", patchFindTool()],
    ["grep", patchGrepTool()],
  ]);
}
