import { describe, expect, it } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  assembleRunDuration,
  registerWorkingIndicator,
} from "./working-indicator";

function mkIndicatorHarness() {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  const pi = {
    on: (event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
    },
  } as unknown as ExtensionAPI;

  let notifyCount = 0;
  const ctx = {
    ui: {
      setWorkingIndicator: () => {},
      setWorkingMessage: () => {},
      notify: () => {
        notifyCount++;
      },
      theme: {
        fg: (_color: string, text: string) => text,
        getFgAnsi: () => "",
        getColorMode: () => "ansi",
      },
    },
  } as unknown as ExtensionContext;

  return { pi, ctx, handlers, getNotifyCount: () => notifyCount };
}

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

describe("registerWorkingIndicator", () => {
  it("does not reuse stale start time after a run ends", () => {
    const { pi, ctx, handlers, getNotifyCount } = mkIndicatorHarness();
    const handle = registerWorkingIndicator(pi, ctx);

    handlers.agent_start![0]!();
    handlers.agent_end![0]!({
      messages: [{ role: "assistant", stopReason: "stop" }],
    });
    handlers.agent_end![0]!({
      messages: [{ role: "assistant", stopReason: "stop" }],
    });

    expect(getNotifyCount()).toBe(1);
    handle.dispose();
  });
});
