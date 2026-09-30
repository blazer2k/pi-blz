import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Handle } from "../shared/handle";
import { patchBashTool } from "./bash";
import { patchLsTool } from "./ls";
import { patchFindTool } from "./find";
import { patchGrepTool } from "./grep";
import { patchReadTool } from "./read";
import { patchWriteTool } from "./write";
import { patchEditTool } from "./edit";

const BUILT_IN_PATCHES = [
  patchReadTool,
  patchWriteTool,
  patchEditTool,
  patchBashTool,
  patchLsTool,
  patchFindTool,
  patchGrepTool,
] as const;

export function patchTools(pi: ExtensionAPI): Handle[] {
  return BUILT_IN_PATCHES.map((patchFn) => patchFn(pi));
}
