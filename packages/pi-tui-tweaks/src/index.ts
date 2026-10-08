import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { getConfig, loadConfig } from "./config/store";
import { registerEditor } from "./editor/registration";
import { registerHeader } from "./header/header";
import type { Handle } from "./shared/handle";
import { createToolRendering } from "./tools/tool-registration";
import { clearBlinkTimers } from "./tools/rendering/state";
import { registerTuiCapture } from "./tools/rendering/tui-runtime";
import { registerWorkingIndicator } from "./working-indicator/indicator";

function disposeHandles(handles: readonly Handle[], description: string): void {
  for (const handle of handles) {
    try {
      handle.dispose();
    } catch (error) {
      console.error(`Failed to dispose ${description} handle:`, error);
    }
  }
}

export default function (pi: ExtensionAPI) {
  loadConfig();
  let uiHandles: Handle[] = [];
  let renderingEnabled = true;
  const activeToolCallIds = new Set<string>();
  const isToolCallActive = (toolCallId: string) =>
    activeToolCallIds.has(toolCallId);
  pi.on("tool_execution_start", async (event) => {
    activeToolCallIds.add(event.toolCallId);
  });
  pi.on("tool_execution_end", async (event) => {
    activeToolCallIds.delete(event.toolCallId);
  });

  const toolRendering = createToolRendering(pi, {
    isToolCallActive,
    isEnabled: () => renderingEnabled,
  });
  pi.registerToolRenderer(toolRendering.resolve);

  pi.on("session_start", async (_event, ctx) => {
    renderingEnabled = true;
    loadConfig((err) => {
      ctx.ui.notify(
        `Config load failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    });

    if (!getConfig().tools.enhanceCustomTools)
      toolRendering.clearCustomTimers();

    if (ctx.mode === "tui") {
      uiHandles.push(registerTuiCapture(ctx));
      uiHandles.push(registerHeader(pi, ctx));
      if (getConfig().editor.style !== "native") {
        uiHandles.push(registerEditor(pi, ctx));
        if (getConfig().workingIndicator.style === "shimmer")
          uiHandles.push(registerWorkingIndicator(pi, ctx));
      }
      ctx.ui.setHiddenThinkingLabel("(think)");
      uiHandles.push({
        dispose() {
          ctx.ui.setHiddenThinkingLabel();
        },
      });
    }
  });

  pi.on("session_shutdown", async () => {
    renderingEnabled = false;
    activeToolCallIds.clear();
    toolRendering.reset();
    clearBlinkTimers();

    disposeHandles(uiHandles, "TUI tweak");
    uiHandles = [];
  });
}
