import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { getConfig, loadConfig } from "./config/store";
import { registerEditor } from "./editor/registration";
import { registerHeader } from "./header/header";
import type { Handle } from "./shared/handle";
import type { BashTiming } from "./tools/bash";
import { createToolRendering } from "./tools/tool-registration";
import { clearBlinkTimers } from "./tools/rendering/state";
import { registerTuiCapture } from "./tools/rendering/tui-runtime";
import { registerWorkingIndicator } from "./working-indicator/indicator";

const BASH_TIMING_ENTRY = "pi-ui-enhancements:bash-timing";

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
  const bashTimings = new Map<string, BashTiming>();
  const activeToolCallIds = new Set<string>();
  const isToolCallActive = (toolCallId: string) =>
    activeToolCallIds.has(toolCallId);
  pi.on("tool_execution_start", async (event) => {
    activeToolCallIds.add(event.toolCallId);
    if (event.toolName === "bash" && !event.parentToolCallId) {
      const source = pi
        .getAllTools()
        .find((tool) => tool.name === "bash")?.sourceInfo;
      if (source?.source === "builtin" && source.path === "builtin:bash")
        bashTimings.set(event.toolCallId, { startedAt: Date.now() });
    }
  });
  pi.on("tool_execution_end", async (event) => {
    activeToolCallIds.delete(event.toolCallId);
    const timing = bashTimings.get(event.toolCallId);
    if (timing?.startedAt !== undefined) {
      const durationMs = Math.max(0, Date.now() - timing.startedAt);
      bashTimings.set(event.toolCallId, { durationMs });
      pi.appendEntry(BASH_TIMING_ENTRY, {
        toolCallId: event.toolCallId,
        durationMs,
      });
    }
  });

  const toolRendering = createToolRendering(pi, {
    isToolCallActive,
    isEnabled: () => renderingEnabled,
    getBashTiming: (toolCallId) => bashTimings.get(toolCallId),
  });
  pi.registerToolRenderer(toolRendering.resolve);

  pi.on("session_start", async (_event, ctx) => {
    renderingEnabled = true;
    bashTimings.clear();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== BASH_TIMING_ENTRY)
        continue;
      const data = entry.data as
        | { toolCallId?: unknown; durationMs?: unknown }
        | undefined;
      if (
        typeof data?.toolCallId === "string" &&
        typeof data.durationMs === "number" &&
        Number.isFinite(data.durationMs) &&
        data.durationMs >= 0
      )
        bashTimings.set(data.toolCallId, { durationMs: data.durationMs });
    }
    loadConfig((err) => {
      ctx.ui.notify(
        `Config load failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    });

    if (!getConfig().patchCustomTools) toolRendering.clearCustomTimers();

    if (ctx.mode === "tui") {
      uiHandles.push(registerTuiCapture(ctx));
      uiHandles.push(registerHeader(ctx));
      if (getConfig().editorStyle !== "native") {
        uiHandles.push(
          registerEditor(pi, ctx),
          registerWorkingIndicator(pi, ctx),
        );
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
    bashTimings.clear();
    toolRendering.reset();
    clearBlinkTimers();

    disposeHandles(uiHandles, "UI enhancement");
    uiHandles = [];
  });
}
