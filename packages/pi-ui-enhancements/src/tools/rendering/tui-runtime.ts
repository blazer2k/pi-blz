import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { Handle } from "../../shared/handle";

const WIDGET_KEY = "pi-ui-enhancements:tui-capture";
type TuiCapture = { tui: TUI };
let currentCapture: TuiCapture | undefined;

export function isFullscreenTui(): boolean {
  return currentCapture?.tui.mode === "fullscreen";
}

export function registerTuiCapture(ctx: ExtensionContext): Handle {
  let capture: TuiCapture | undefined;
  let disposed = false;
  ctx.ui.setWidget(
    WIDGET_KEY,
    (tui) => {
      const instance = { tui };
      capture = instance;
      currentCapture = instance;
      return {
        render: () => [],
        invalidate() {},
        dispose() {
          if (currentCapture === instance) currentCapture = undefined;
        },
      };
    },
    { placement: "belowEditor" },
  );

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (currentCapture !== capture) return;
      try {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
      } finally {
        if (currentCapture === capture) currentCapture = undefined;
      }
    },
  };
}
