import { describe, expect, it } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatTokens, getTotalUsage } from "./rounded-editor";

describe("getTotalUsage", () => {
  it("sums assistant usage from the active branch only", () => {
    const branchEntries = [
      {
        type: "message",
        message: {
          role: "assistant",
          usage: {
            input: 10,
            output: 5,
            cacheRead: 2,
            cacheWrite: 1,
            cost: { total: 0.25 },
          },
        },
      },
    ];
    const allEntries = [
      ...branchEntries,
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 1000, output: 1000, cost: { total: 99 } },
        },
      },
    ];
    const ctx = {
      sessionManager: {
        getBranch: () => branchEntries,
        getEntries: () => allEntries,
      },
    } as unknown as ExtensionContext;

    expect(getTotalUsage(ctx)).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      totalCost: 0.25,
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
