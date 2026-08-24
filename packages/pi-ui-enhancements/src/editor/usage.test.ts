import { describe, expect, it } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatTokens, getTotalUsage } from "./usage";

describe("getTotalUsage", () => {
  const usage = (
    input: number,
    output: number,
    cost: number,
    cacheRead = 0,
    cacheWrite = 0,
  ) => ({ input, output, cacheRead, cacheWrite, cost: { total: cost } });

  it("sums usage from all session entries, not just the active branch", () => {
    const allEntries = [
      {
        type: "message",
        message: { role: "assistant", usage: usage(10, 5, 0.25, 2, 1) },
      },
      {
        type: "message",
        message: { role: "toolResult", usage: usage(1, 2, 0.5) },
      },
      { type: "compaction", usage: usage(3, 4, 0.125, 5) },
      { type: "branch_summary", usage: usage(6, 7, 0.0625, 0, 8) },
      // Entry outside the active branch (e.g. compacted or sibling history)
      {
        type: "message",
        message: { role: "assistant", usage: usage(1000, 1000, 99) },
      },
    ];
    const ctx = {
      sessionManager: {
        getBranch: () => allEntries.slice(0, 1),
        getEntries: () => allEntries,
      },
    } as unknown as ExtensionContext;

    expect(getTotalUsage(ctx)).toEqual({
      inputTokens: 10 + 1 + 3 + 6 + 1000,
      outputTokens: 5 + 2 + 4 + 7 + 1000,
      cacheReadTokens: 2 + 5,
      cacheWriteTokens: 1 + 8,
      totalCost: 0.25 + 0.5 + 0.125 + 0.0625 + 99,
    });
  });

  it("skips entries without usage", () => {
    const allEntries = [
      { type: "message", message: { role: "user", content: [] } },
      { type: "message", message: { role: "toolResult" } },
      { type: "compaction", summary: "" },
      { type: "branch_summary", summary: "" },
    ];
    const ctx = {
      sessionManager: {
        getEntries: () => allEntries,
      },
    } as unknown as ExtensionContext;

    expect(getTotalUsage(ctx)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0,
    });
  });
});

describe("formatTokens", () => {
  it("returns raw number under 1000", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with one decimal under 10000", () => {
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(9900)).toBe("9.9k");
  });

  it("formats thousands as rounded integer under 1000000", () => {
    expect(formatTokens(15000)).toBe("15k");
    expect(formatTokens(99400)).toBe("99k");
  });

  it("formats millions with one decimal", () => {
    expect(formatTokens(1500000)).toBe("1.5M");
    expect(formatTokens(9900000)).toBe("9.9M");
  });
});
