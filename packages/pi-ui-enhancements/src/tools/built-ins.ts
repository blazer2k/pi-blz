import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { patchBashTool, type BashTimingLookup } from "./bash";
import { patchLsTool } from "./ls";
import { patchFindTool } from "./find";
import { patchGrepTool } from "./grep";
import { patchReadTool } from "./read";
import { patchWriteTool } from "./write";
import { patchEditTool } from "./edit";

export function patchTools(
  getBashTiming?: BashTimingLookup,
): ReadonlyMap<string, ToolRenderers> {
  return new Map([
    ["read", patchReadTool()],
    ["write", patchWriteTool()],
    ["edit", patchEditTool()],
    ["bash", patchBashTool(getBashTiming)],
    ["ls", patchLsTool()],
    ["find", patchFindTool()],
    ["grep", patchGrepTool()],
  ]);
}
