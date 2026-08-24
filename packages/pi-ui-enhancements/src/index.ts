import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerConfigCommand } from "./config/command";
import {
  clearOnConfigChange,
  getConfig,
  loadConfig,
  setOnConfigChange,
} from "./config/store";
import { registerRoundedEditor } from "./editor/registration";
import { registerAsciiHeader } from "./header/header";
import type { Handle } from "./shared/handle";
import { patchTools } from "./tools/built-ins";
import { patchCustomToolRendering } from "./tools/custom-tools/patch-manager";
import { clearBlinkTimers } from "./tools/rendering/state";
import { registerWorkingIndicator } from "./working-indicator/indicator";

function hasTui(ctx: { hasUI: boolean; mode?: string }): boolean {
  return ctx.mode === "tui" || (ctx.mode === undefined && ctx.hasUI);
}

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
  const builtInToolHandles = patchTools(pi);
  let uiHandles: Handle[] = [];

  const activeToolCallIds = new Set<string>();
  const isToolCallActive = (toolCallId: string) =>
    activeToolCallIds.has(toolCallId);
  pi.on("tool_execution_start", async (event) => {
    activeToolCallIds.add(event.toolCallId);
  });
  pi.on("tool_execution_end", async (event) => {
    activeToolCallIds.delete(event.toolCallId);
  });

  let customToolRenderingHandle: Handle | null = getConfig().patchCustomTools
    ? patchCustomToolRendering(isToolCallActive)
    : null;

  let headerReregister: (() => void) | null = null;
  let editorReregister: (() => void) | null = null;
  let settingsUiActive = false;

  function syncCustomToolRenderingPatch() {
    if (getConfig().patchCustomTools && !customToolRenderingHandle) {
      customToolRenderingHandle = patchCustomToolRendering(isToolCallActive);
    } else if (!getConfig().patchCustomTools && customToolRenderingHandle) {
      customToolRenderingHandle.dispose();
      customToolRenderingHandle = null;
    }
  }

  function handleConfigChange() {
    syncCustomToolRenderingPatch();
    headerReregister?.();
    if (!settingsUiActive) {
      editorReregister?.();
    }
  }

  setOnConfigChange(handleConfigChange);

  registerConfigCommand(
    pi,
    () => {
      settingsUiActive = true;
    },
    () => {
      settingsUiActive = false;
    },
  );

  pi.on("session_start", async (_event, ctx) => {
    // Reset in case settings UI was force-closed last session
    settingsUiActive = false;
    loadConfig((err) => {
      ctx.ui.notify(
        `Config load failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    });

    // Reinstall after the previous session_shutdown cleared the global callback.
    setOnConfigChange(handleConfigChange);

    // Apply config changes made before session start while keeping the patch early
    // enough for history rendering after /reload
    syncCustomToolRenderingPatch();

    if (hasTui(ctx)) {
      uiHandles.push(
        registerAsciiHeader(pi, ctx, (fn) => {
          headerReregister = fn;
        }),
        registerRoundedEditor(pi, ctx, (fn) => {
          editorReregister = fn;
        }),
        registerWorkingIndicator(pi, ctx),
      );
      ctx.ui.setHiddenThinkingLabel("(think)");
      uiHandles.push({
        dispose() {
          ctx.ui.setHiddenThinkingLabel();
        },
      });
    }
  });

  pi.on("session_shutdown", async () => {
    activeToolCallIds.clear();
    clearBlinkTimers();

    disposeHandles(uiHandles, "UI enhancement");
    uiHandles = [];
    disposeHandles(builtInToolHandles, "built-in tool");

    try {
      customToolRenderingHandle?.dispose();
    } catch (error) {
      console.error("Failed to dispose custom tool rendering patch:", error);
    }
    customToolRenderingHandle = null;
    headerReregister = null;
    editorReregister = null;
    clearOnConfigChange();
  });
}
