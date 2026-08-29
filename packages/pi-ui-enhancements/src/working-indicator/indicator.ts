import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { getConfig } from "../config/store";
import type { Handle } from "../shared/handle";
import { RESET_FG, type Color, rgbFg, blend, resolveTheme } from "./colors";

const LABEL = "Working";
const INTERRUPT_MSG = "esc to interrupt";

// 10 FPS - position is wall-clock based, so sweep speed is unchanged;
// this only coarsens sampling to keep long-session frame costs down
const ANIM_INTERVAL_MS = 100;

type WorkingIndicatorAssistantMessage = {
  role: string;
  stopReason?: string;
};

type WorkingIndicatorSession = {
  start(): void;
  noteMessageEnd(message: WorkingIndicatorAssistantMessage | undefined): void;
  noteCompaction(): void;
  noteInput(): void;
  pauseForPrompt(): void;
  resumeAfterPrompt(): void;
  settle(): void;
  dispose(): void;
};

type WorkingIndicatorRuntime = {
  current: WorkingIndicatorSession | null;
};

const runtimes = new WeakMap<ExtensionAPI, WorkingIndicatorRuntime>();

function getRuntime(pi: ExtensionAPI): WorkingIndicatorRuntime {
  let runtime = runtimes.get(pi);
  if (runtime) return runtime;

  runtime = { current: null };
  pi.on("agent_start", async () => {
    runtime.current?.start();
  });
  pi.on("message_end", async (event: { message?: unknown }) => {
    runtime.current?.noteMessageEnd(
      event.message as WorkingIndicatorAssistantMessage | undefined,
    );
  });
  pi.on("session_before_compact", async () => {
    runtime.current?.noteCompaction();
  });
  pi.on("input", async () => {
    runtime.current?.noteInput();
  });
  pi.on("ui_prompt_start", async () => {
    runtime.current?.pauseForPrompt();
  });
  pi.on("ui_prompt_end", async () => {
    runtime.current?.resumeAfterPrompt();
  });
  pi.on("agent_settled", async () => {
    runtime.current?.settle();
  });
  runtimes.set(pi, runtime);
  return runtime;
}

function shimmerText(
  text: string,
  baseRgb: Color | undefined,
  highlightRgb: Color | undefined,
  theme: Theme,
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
    out = theme.fg("dim", text);
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
  const runtime = getRuntime(pi);
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

  function renderFrame(): void {
    const cfg = getConfig();
    const theme = resolveTheme(ctx);
    const shimmered = shimmerText(
      LABEL,
      theme.baseRgb,
      theme.highlightRgb,
      ctx.ui.theme,
    );
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

  function startAnimation(): void {
    // Always render immediately so a state change is visible even when
    // the interval from a previous run is still active.
    ctx.ui.setWorkingMessage("");
    renderFrame();
    if (animTimer) return;
    animTimer = setInterval(renderFrame, ANIM_INTERVAL_MS);
  }

  let compactionPending = false;
  let promptStartedAt = 0;
  let lastStopReason: string | undefined;

  const session: WorkingIndicatorSession = {
    start() {
      // A compaction split continues the same task, so keep the original
      // start time and let the compaction gap count toward the total.
      if (!compactionPending) runStartTime = Date.now();
      compactionPending = false;
      startAnimation();
    },
    noteMessageEnd(message) {
      if (message?.role === "assistant") lastStopReason = message.stopReason;
    },
    noteCompaction() {
      // A mid-run compaction sets this too, but the running timer is
      // already correct; noteInput() clears any stale mark before the
      // next task starts.
      compactionPending = true;
    },
    noteInput() {
      // New user input starts a new task: drop task-bound state.
      compactionPending = false;
      promptStartedAt = 0;
      lastStopReason = undefined;
    },
    pauseForPrompt() {
      if (runStartTime === 0 || promptStartedAt > 0) return;
      promptStartedAt = Date.now();
      stopIndicator();
    },
    resumeAfterPrompt() {
      if (promptStartedAt === 0) return;

      const promptDuration = Math.max(0, Date.now() - promptStartedAt);
      promptStartedAt = 0;
      if (runStartTime === 0) return;

      runStartTime += promptDuration;
      startAnimation();
    },
    settle() {
      // agent_settled fires only when no retry, compaction, or queued
      // continuation will run, so this is the true end of the task.
      const startedAt = runStartTime;
      runStartTime = 0;
      stopIndicator();

      if (
        startedAt > 0 &&
        lastStopReason === "stop" &&
        getConfig().workingIndicatorShowDuration
      ) {
        ctx.ui.notify(`Worked for ${assembleRunDuration(startedAt)}`);
      }
      lastStopReason = undefined;
      compactionPending = false;
      promptStartedAt = 0;
    },
    dispose() {
      if (runtime.current === session) {
        runtime.current = null;
      }
      stopAnimation();
      ctx.ui.setWorkingMessage("");
      ctx.ui.setWorkingIndicator();
    },
  };

  runtime.current = session;
  return session;
}
