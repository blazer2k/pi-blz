import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerRoundedEditor } from "./rounded-editor";
import { registerWorkingIndicator } from "./working-indicator";
import { patchReadTool } from "./tools/read";
import { patchWriteTool } from "./tools/write";
import { patchBashTool } from "./tools/bash";
import type { Handle } from "./types";

let handles: Handle[] = [];

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    handles = [
      patchReadTool(pi, ctx),
      patchWriteTool(pi, ctx),
      patchBashTool(pi, ctx),
    ];

    if (ctx.hasUI) {
      handles.push(
        registerRoundedEditor(pi, ctx),
        registerWorkingIndicator(pi, ctx),
      );
    }
  });

  pi.on("session_shutdown", async () => {
    for (const h of handles) {
      h.dispose();
    }
    handles = [];
  });
}
