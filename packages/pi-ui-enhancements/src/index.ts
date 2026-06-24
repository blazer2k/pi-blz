import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerAsciiHeader } from "./ascii-header";
import { registerRoundedEditor } from "./rounded-editor";
import { patchTools } from "./tools";
import { patchCustomToolRendering } from "./tools/custom-tool-rendering";
import { clearBlinkTimers } from "./tools/tool-rendering";
import type { Handle } from "./types";
import { registerWorkingIndicator } from "./working-indicator";
import {
  getConfig,
  loadConfig,
  setOnConfigChange,
  clearOnConfigChange,
} from "./config";
import { registerConfigCommand } from "./settings-command";

let handles: Handle[] = [];

function hasTui(ctx: { hasUI: boolean; mode?: string }): boolean {
  return ctx.mode === "tui" || (ctx.mode === undefined && ctx.hasUI);
}

export default function (pi: ExtensionAPI) {
  patchTools(pi);
  loadConfig();
  let customToolRenderingHandle: Handle | null = getConfig().patchCustomTools
    ? patchCustomToolRendering()
    : null;

  let headerReregister: (() => void) | null = null;
  let editorReregister: (() => void) | null = null;
  let settingsUiActive = false;

  function syncCustomToolRenderingPatch() {
    if (getConfig().patchCustomTools && !customToolRenderingHandle) {
      customToolRenderingHandle = patchCustomToolRendering();
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
      handles.push(
        registerAsciiHeader(pi, ctx, (fn) => {
          headerReregister = fn;
        }),
        registerRoundedEditor(pi, ctx, (fn) => {
          editorReregister = fn;
        }),
        registerWorkingIndicator(pi, ctx),
      );
      ctx.ui.setHiddenThinkingLabel("(think)");
      handles.push({
        dispose() {
          ctx.ui.setHiddenThinkingLabel();
        },
      });
    }
  });

  pi.on("session_shutdown", async () => {
    clearBlinkTimers();

    for (const h of handles) {
      try {
        h.dispose();
      } catch (error) {
        console.error("Failed to dispose UI enhancement handle:", error);
      }
    }
    handles = [];

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
