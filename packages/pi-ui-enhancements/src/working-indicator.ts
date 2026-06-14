import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { RESET_FG, type Color, rgbFg, blend, resolveTheme } from "./colors";

export type WorkingPhase = "idle" | "processing" | "thinking" | "working";

// 20 FPS
const ANIM_INTERVAL_MS = 50;

function getMessageForPhase(phase: WorkingPhase): string {
  switch (phase) {
    case "processing":
      return "Processing";
    case "thinking":
      return "Thinking";
    case "working":
      return "Working";
    default:
      return "";
  }
}

function getPhaseFromEvent(event: AssistantMessageEvent): WorkingPhase {
  switch (event.type) {
    case "start":
      return "processing";
    case "thinking_start":
    case "thinking_delta":
    case "thinking_end":
      return "thinking";
    case "text_start":
    case "text_delta":
    case "text_end":
    case "toolcall_start":
    case "toolcall_delta":
    case "toolcall_end":
      return "working";
    case "done":
    case "error":
      return "idle";
    default:
      return "idle";
  }
}

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

export function setupWorkingIndicator(pi: ExtensionAPI) {
  let currentPhase: WorkingPhase = "idle";

  let animTimer: ReturnType<typeof setInterval> | null = null;

  let baseRgb: Color | undefined;
  let hiRgb: Color | undefined;

  function applyPhase(ctx: ExtensionContext): void {
    const theme = resolveTheme(ctx);
    baseRgb = theme.baseRgb;
    hiRgb = theme.highlightRgb;
    const message = getMessageForPhase(currentPhase);

    if (!message) {
      ctx.ui.setWorkingIndicator({ frames: [] });
      ctx.ui.setWorkingMessage("");
      stopAnimation();
      return;
    }

    stopAnimation();
    ctx.ui.setWorkingMessage("");

    function renderFrame(): void {
      const shimmered = shimmerText(
        getMessageForPhase(currentPhase),
        baseRgb,
        hiRgb,
      );
      ctx.ui.setWorkingIndicator({
        frames: [shimmered],
        intervalMs: ANIM_INTERVAL_MS,
      });
    }

    renderFrame();
    animTimer = setInterval(renderFrame, ANIM_INTERVAL_MS);
  }

  function setPhase(ctx: ExtensionContext, phase: WorkingPhase): void {
    if (currentPhase !== phase) {
      currentPhase = phase;
      applyPhase(ctx);
    }
  }

  function stopAnimation(): void {
    if (animTimer) {
      clearInterval(animTimer);
      animTimer = null;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    currentPhase = "idle";
    ctx.ui.setWorkingIndicator({ frames: [] });
    ctx.ui.setWorkingMessage("");
    stopAnimation();
  });

  pi.on("agent_start", async (_event, ctx) => {
    setPhase(ctx, "processing");
  });

  pi.on("turn_start", async (_event, ctx) => {
    setPhase(ctx, "processing");
  });

  pi.on("message_update", async (event, ctx) => {
    setPhase(ctx, getPhaseFromEvent(event.assistantMessageEvent));
  });

  pi.on("agent_end", async (_event, ctx) => {
    setPhase(ctx, "idle");
  });
}
