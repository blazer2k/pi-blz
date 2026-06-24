import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getConfig } from "../config";
import type { Handle } from "../types";
import { patchBashTool } from "./bash";
import { patchLsTool } from "./ls";
import { patchFindTool } from "./find";
import { patchGrepTool } from "./grep";
import { patchReadTool } from "./read";
import { patchWriteTool } from "./write";
import { patchEditTool } from "./edit";

const ESSENTIAL_PATCHES = [
  patchReadTool,
  patchWriteTool,
  patchEditTool,
  patchBashTool,
] as const;

const EXTRA_PATCHES = [patchLsTool, patchFindTool, patchGrepTool] as const;

export function patchTools(pi: ExtensionAPI): Handle[] {
  const patches =
    getConfig().patchedBuiltInTools === "all"
      ? [...ESSENTIAL_PATCHES, ...EXTRA_PATCHES]
      : ESSENTIAL_PATCHES;

  return patches.map((patchFn) => patchFn(pi));
}
