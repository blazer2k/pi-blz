import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerRoundedEditor } from "./rounded-editor";
import { patchTools } from "./tools";
import type { Handle } from "./types";
import { registerWorkingIndicator } from "./working-indicator";

let handles: Handle[] = [];

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    handles = patchTools(pi, ctx);
    pi.setActiveTools(["read", "write", "edit", "bash", "ls", "find", "grep"]);

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
