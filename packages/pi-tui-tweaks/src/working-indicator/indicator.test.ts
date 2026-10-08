import { describe, expect, it } from "bun:test";
import {
  createExtensionRuntime,
  ExtensionRunner,
  type Extension,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  indexedColor,
  oklchColor,
  rgbColor,
  type Color as ThemeColor,
} from "@earendil-works/pi-tui";
import { assembleRunDuration, registerWorkingIndicator } from "./indicator";

function mkIndicatorHarness(colors?: {
  muted: ThemeColor;
  accent: ThemeColor;
}) {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  const pi = {
    on: (event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
    },
  } as unknown as ExtensionAPI;

  let notifyCount = 0;
  let lastFrames: string[] | null = null;
  let lastIntervalMs: number | undefined;
  const ctx = {
    ui: {
      setWorkingIndicator: (options?: {
        frames: string[];
        intervalMs?: number;
      }) => {
        lastFrames = options?.frames ?? null;
        lastIntervalMs = options?.intervalMs;
      },
      setWorkingMessage: () => {},
      notify: () => {
        notifyCount++;
      },
      theme: {
        colors,
        fg: (_color: string, text: string) => text,
        getFgAnsi: () => "",
        getColorMode: () => (colors ? "truecolor" : "ansi"),
      },
    },
  } as unknown as ExtensionContext;

  return {
    pi,
    ctx,
    handlers,
    getNotifyCount: () => notifyCount,
    getLastFrames: () => lastFrames,
    getLastIntervalMs: () => lastIntervalMs,
  };
}

function installFakeClock(initialTime = 10_000) {
  const originalNow = Date.now;
  let now = initialTime;
  Date.now = () => now;

  return {
    advance(milliseconds: number) {
      now += milliseconds;
    },
    restore() {
      Date.now = originalNow;
    },
  };
}

describe("working indicator colors", () => {
  for (const [name, ansi] of [
    ["terminal-default", "\x1b[39m"],
    ["faint", "\x1b[38;2;40;50;60m\x1b[2m"],
  ] as const) {
    it(`uses resolved ${name} colors instead of ANSI escapes`, () => {
      const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness({
        muted: rgbColor(10, 20, 30),
        accent: rgbColor(100, 150, 200),
      });
      ctx.ui.theme.getFgAnsi = () => ansi;
      const clock = installFakeClock(11_000);
      const handle = registerWorkingIndicator(pi, ctx);
      try {
        handlers.agent_start![0]!();
        expect(getLastFrames()![0]).toStartWith("\x1b[38;2;27;44;62mW\x1b[39m");
      } finally {
        handle.dispose();
        clock.restore();
      }
    });
  }

  it("mixes indexed and OKLCH theme colors in RGB", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness({
      muted: indexedColor(196),
      accent: oklchColor(1, 0, 0),
    });
    const clock = installFakeClock(11_000);
    const handle = registerWorkingIndicator(pi, ctx);
    try {
      handlers.agent_start![0]!();
      expect(getLastFrames()![0]).toStartWith("\x1b[38;2;255;47;47mW\x1b[39m");
      expect(getLastFrames()![0]).toContain("\x1b[38;2;255;224;224mk\x1b[39m");
    } finally {
      handle.dispose();
      clock.restore();
    }
  });

  it("uses dim text without resolving colors outside truecolor mode", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    ctx.ui.theme.getColorMode = () => "256color";
    ctx.ui.theme.fg = (color, text) => `[${color}]${text}`;
    Object.defineProperty(ctx.ui.theme, "colors", {
      get() {
        throw new Error("Non-truecolor rendering must not resolve colors");
      },
    });
    const handle = registerWorkingIndicator(pi, ctx);
    try {
      handlers.agent_start![0]!();
      expect(getLastFrames()![0]).toStartWith("[dim]Working");
      expect(getLastFrames()![0]).not.toContain("\x1b[38;2;");
    } finally {
      handle.dispose();
    }
  });

  it("reads current theme colors on each frame", () => {
    const colors = {
      muted: rgbColor(10, 20, 30),
      accent: rgbColor(100, 150, 200),
    };
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness(colors);
    const clock = installFakeClock();
    const handle = registerWorkingIndicator(pi, ctx);
    try {
      handlers.agent_start![0]!();
      expect(getLastFrames()![0]).toStartWith("\x1b[38;2;10;20;30mW");
      colors.muted = rgbColor(40, 50, 60);
      colors.accent = rgbColor(200, 150, 100);
      clock.advance(1_000);
      handlers.agent_start![0]!();
      expect(getLastFrames()![0]).toStartWith("\x1b[38;2;70;69;67mW");
    } finally {
      handle.dispose();
      clock.restore();
    }
  });

  it("preserves the two-second sweep, frame interval, and per-character resets", () => {
    const { pi, ctx, handlers, getLastFrames, getLastIntervalMs } =
      mkIndicatorHarness({
        muted: rgbColor(10, 20, 30),
        accent: rgbColor(100, 150, 200),
      });
    const clock = installFakeClock();
    const handle = registerWorkingIndicator(pi, ctx);
    try {
      handlers.agent_start![0]!();
      const first = getLastFrames()![0]!;
      const base = [..."Working"]
        .map((ch) => `\x1b[38;2;10;20;30m${ch}\x1b[39m`)
        .join("");
      expect(first).toStartWith(base);
      expect(getLastIntervalMs()).toBe(100);
      clock.advance(1_000);
      handlers.agent_start![0]!();
      expect(getLastFrames()![0]).toStartWith(
        "\x1b[38;2;27;44;62mW\x1b[39m\x1b[38;2;51;79;107mo\x1b[39m" +
          "\x1b[38;2;74;113;151mr\x1b[39m\x1b[38;2;89;134;179mk\x1b[39m" +
          "\x1b[38;2;89;134;179mi\x1b[39m\x1b[38;2;74;113;151mn\x1b[39m" +
          "\x1b[38;2;51;79;107mg\x1b[39m",
      );
      clock.advance(1_000);
      handlers.agent_start![0]!();
      expect(getLastFrames()![0]).toBe(first);
    } finally {
      handle.dispose();
      clock.restore();
    }
  });
});

describe("assembleRunDuration", () => {
  it("formats seconds only", () => {
    const start = Date.now() - 30_000;
    expect(assembleRunDuration(start)).toBe("30s");
  });

  it("formats minutes and seconds", () => {
    const start = Date.now() - 125_000;
    expect(assembleRunDuration(start)).toBe("2m 5s");
  });

  it("formats hours, minutes and seconds", () => {
    const start = Date.now() - 3_700_000;
    expect(assembleRunDuration(start)).toBe("1h 1m 40s");
  });

  it("formats zero seconds", () => {
    // Use immediate past to avoid rounding edge
    const start = Date.now() - 400;
    expect(assembleRunDuration(start)).toBe("0s");
  });
});

function emitAssistantMessageEnd(
  handlers: Record<string, Array<(...args: any[]) => void>>,
  stopReason: string,
) {
  handlers.message_end![0]!({
    type: "message_end",
    message: { role: "assistant", stopReason },
  });
}

describe("registerWorkingIndicator", () => {
  it("notifies on agent_settled after a clean run", () => {
    const { pi, ctx, handlers, getNotifyCount } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    emitAssistantMessageEnd(handlers, "stop");
    expect(getNotifyCount()).toBe(0);
    handlers.agent_settled![0]!({ type: "agent_settled" });

    expect(getNotifyCount()).toBe(1);
    handle.dispose();
  });

  it("handles missing message_end payload defensively", () => {
    const { pi, ctx, handlers, getNotifyCount } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    expect(() => handlers.message_end![0]!({})).not.toThrow();
    handlers.agent_settled![0]!({ type: "agent_settled" });

    expect(getNotifyCount()).toBe(0);
    handle.dispose();
  });

  it("hides the indicator when the run settles", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    expect(getLastFrames()!.join("\n")).toContain("Working");
    handlers.agent_settled![0]!({ type: "agent_settled" });

    expect(getLastFrames()).toEqual([]);
    handle.dispose();
  });
});

describe("working indicator across UI prompts", () => {
  it("pauses while waiting for input and excludes that time", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const clock = installFakeClock();
    const handle = registerWorkingIndicator(pi, ctx);

    try {
      handlers.agent_start![0]!();
      clock.advance(1_100);
      handlers.ui_prompt_start![0]!({
        type: "ui_prompt_start",
        reason: "ui_prompt",
        kind: "custom",
      });
      expect(getLastFrames()).toEqual([]);

      clock.advance(5_000);
      handlers.ui_prompt_end![0]!({
        type: "ui_prompt_end",
        reason: "ui_prompt",
        kind: "custom",
      });

      expect(getLastFrames()!.join("\n")).toContain("Working");
      expect(getLastFrames()!.join("\n")).toContain("1s");
      expect(getLastFrames()!.join("\n")).not.toContain("6s");
    } finally {
      handle.dispose();
      clock.restore();
    }
  });

  it("reacts to prompts emitted by Pi's wrapped UI context", async () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);
    const extensionPath = "working-indicator-test";
    const extension: Extension = {
      path: extensionPath,
      resolvedPath: extensionPath,
      sourceInfo: {
        path: extensionPath,
        source: "test",
        scope: "temporary",
        origin: "top-level",
      },
      handlers: new Map(Object.entries(handlers)) as Extension["handlers"],
      tools: new Map(),
      messageRenderers: new Map(),
      commands: new Map(),
      flags: new Map(),
      shortcuts: new Map(),
    };
    const runner = new ExtensionRunner(
      [extension],
      createExtensionRuntime(),
      process.cwd(),
      {} as never,
      {} as never,
    );
    let closePrompt: (() => void) | undefined;
    const pendingPrompt = new Promise<void>((resolve) => {
      closePrompt = resolve;
    });
    runner.setUIContext(
      {
        custom: async () => pendingPrompt,
      } as unknown as ExtensionUIContext,
      "tui",
    );

    try {
      handlers.agent_start![0]!();
      const prompt = runner.getUIContext().custom(() => null as never);
      await Promise.resolve();
      expect(getLastFrames()).toEqual([]);

      closePrompt!();
      await prompt;
      await Promise.resolve();
      expect(getLastFrames()!.join("\n")).toContain("Working");
    } finally {
      closePrompt?.();
      handle.dispose();
    }
  });

  it("ignores prompts while the agent is idle", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.ui_prompt_start![0]!({
      type: "ui_prompt_start",
      reason: "ui_prompt",
      kind: "select",
      title: "Choose",
    });
    handlers.ui_prompt_end![0]!({
      type: "ui_prompt_end",
      reason: "ui_prompt",
      kind: "select",
      title: "Choose",
    });

    expect(getLastFrames()).toBeNull();
    handle.dispose();
  });

  it("does not resume after the run settles during a prompt", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    handlers.ui_prompt_start![0]!({
      type: "ui_prompt_start",
      reason: "ui_prompt",
      kind: "confirm",
      title: "Continue?",
    });
    handlers.agent_settled![0]!({ type: "agent_settled" });
    handlers.ui_prompt_end![0]!({
      type: "ui_prompt_end",
      reason: "ui_prompt",
      kind: "confirm",
      title: "Continue?",
    });

    expect(getLastFrames()).toEqual([]);
    handle.dispose();
  });
});

describe("working indicator across auto-compaction", () => {
  it("keeps the total running time across a compaction split", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const clock = installFakeClock();
    const handle = registerWorkingIndicator(pi, ctx);

    try {
      handlers.agent_start![0]!();
      clock.advance(1_100);
      handlers["session_before_compact"]![0]!({
        type: "session_before_compact",
        reason: "threshold",
      });
      handlers.agent_start![0]!();

      expect(getLastFrames()!.join("\n")).toContain("1s");
    } finally {
      handle.dispose();
      clock.restore();
    }
  });

  it("keeps the indicator lit through the compaction gap", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    handlers["session_before_compact"]![0]!({
      type: "session_before_compact",
      reason: "threshold",
    });

    expect(getLastFrames()!.join("\n")).toContain("Working");
    handle.dispose();
  });

  it("resets the timer for a new task after compaction", () => {
    const { pi, ctx, handlers, getLastFrames } = mkIndicatorHarness();
    const clock = installFakeClock();
    const handle = registerWorkingIndicator(pi, ctx);

    try {
      handlers.agent_start![0]!();
      clock.advance(1_100);
      handlers["session_before_compact"]![0]!({
        type: "session_before_compact",
        reason: "threshold",
      });
      handlers.input![0]!({
        type: "input",
        text: "next task",
        source: "interactive",
      });
      handlers.agent_start![0]!();

      expect(getLastFrames()!.join("\n")).toContain("0s");
    } finally {
      handle.dispose();
      clock.restore();
    }
  });

  it("notifies once at final settle across a compaction split", () => {
    const { pi, ctx, handlers, getNotifyCount } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    emitAssistantMessageEnd(handlers, "stop");
    handlers["session_before_compact"]![0]!({
      type: "session_before_compact",
      reason: "threshold",
    });
    handlers.agent_start![0]!();
    emitAssistantMessageEnd(handlers, "stop");
    expect(getNotifyCount()).toBe(0);
    handlers.agent_settled![0]!({ type: "agent_settled" });

    expect(getNotifyCount()).toBe(1);
    handle.dispose();
  });

  it("does not notify for aborted runs", () => {
    const { pi, ctx, handlers, getNotifyCount } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    emitAssistantMessageEnd(handlers, "aborted");
    handlers.agent_settled![0]!({ type: "agent_settled" });

    expect(getNotifyCount()).toBe(0);
    handle.dispose();
  });
});
