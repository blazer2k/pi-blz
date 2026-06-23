import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { RESET_FG, type Color, rgbFg, blend, resolveTheme } from "./colors";
import type { Handle } from "./types";
import { getConfig } from "./config";

const LABEL = "Working";
const INTERRUPT_MSG = "esc to interrupt";

// 20 FPS
const ANIM_INTERVAL_MS = 50;

function shimmerText(
  text: string,
  baseRgb: Color | undefined,
  highlightRgb: Color | undefined,
): string {
  const t = Date.now() / 1000;
  const chars = [...text];
  const pad = 10;
  const period = chars.length + pad * 2;
  const sweep = 2.0;
  const pos = ((t % sweep) / sweep) * period;
  const half = 5.0;
  let out = "";

  if (baseRgb && highlightRgb) {
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      const dist = Math.abs(i + pad - pos);
      const intensity =
        dist <= half ? 0.5 * (1 + Math.cos((Math.PI * dist) / half)) : 0;

      const blended = blend(baseRgb, highlightRgb, intensity * 0.9);
      out += `${rgbFg(blended)}${ch}${RESET_FG}`;
    }
  } else {
    // Fallback
    out = text;
  }
  return out;
}

export function assembleRunDuration(start: number): string {
  const duration = Date.now() - start;
  const totalSeconds = Math.round(duration / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

export function registerWorkingIndicator(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Handle {
  let runStartTime = 0;
  let animTimer: ReturnType<typeof setInterval> | null = null;

  function stopAnimation(): void {
    if (animTimer) {
      clearInterval(animTimer);
      animTimer = null;
    }
  }

  function stopIndicator(): void {
    ctx.ui.setWorkingIndicator({ frames: [] });
    ctx.ui.setWorkingMessage("");
    stopAnimation();
  }

  function startAnimation(): void {
    if (animTimer) return;
    ctx.ui.setWorkingMessage("");

    function renderFrame(): void {
      const cfg = getConfig();
      const theme = resolveTheme(ctx);
      const shimmered = shimmerText(LABEL, theme.baseRgb, theme.highlightRgb);
      const suffixParts: string[] = [];

      if (runStartTime > 0 && cfg.workingIndicatorShowDuration) {
        suffixParts.push(assembleRunDuration(runStartTime));
      }

      if (cfg.workingIndicatorShowInterruptMsg) {
        suffixParts.push(INTERRUPT_MSG);
      }

      const frames = [
        shimmered +
          (suffixParts.length > 0
            ? ctx.ui.theme.fg("dim", ` (${suffixParts.join(" • ")})`)
            : ""),
      ];

      ctx.ui.setWorkingIndicator({
        frames,
        intervalMs: ANIM_INTERVAL_MS,
      });
    }

    renderFrame();
    animTimer = setInterval(renderFrame, ANIM_INTERVAL_MS);
  }

  pi.on("agent_start", async (_event) => {
    runStartTime = Date.now();
    startAnimation();
  });

  pi.on("agent_end", async (event) => {
    stopIndicator();

    if (runStartTime > 0 && getConfig().workingIndicatorShowDuration) {
      const lastAssistant = [...event.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (lastAssistant?.stopReason === "stop") {
        ctx.ui.notify(`Worked for ${assembleRunDuration(runStartTime)}`);
      }
    }
  });

  return {
    dispose() {
      stopIndicator();
    },
  };
}
