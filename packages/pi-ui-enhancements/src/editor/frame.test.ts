import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  type EditorFrameData,
  frameEditorLines,
  formatStatusLine,
  getRightBorderGlyph,
} from "./frame";

const footerTheme = { fg: (_color: string, text: string) => text };
const plainBorder = (text: string) => text;
const frameData: EditorFrameData = {
  cwd: "/repo",
  modelId: "m",
  thinkingLevel: null,
  pct: "42%",
  pctValue: 42,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
  showCacheTokens: false,
  showCost: false,
};

describe("frameEditorLines", () => {
  it("replaces pi's native frame without changing the source lines", () => {
    const nativeLines = ["─".repeat(18), "hello".padEnd(18), "─".repeat(18)];

    expect(
      frameEditorLines(nativeLines, 20, frameData, footerTheme, plainBorder),
    ).toEqual([
      "╭────────── /repo ─╮",
      "│hello             │",
      "╰─ m ──────── 42% ─╯",
    ]);
    expect(nativeLines).toEqual([
      "─".repeat(18),
      "hello".padEnd(18),
      "─".repeat(18),
    ]);
  });

  it("moves pi's scroll indicators onto the right border", () => {
    const nativeLines = [
      "─── ↑ 2 more ─────",
      "first".padEnd(18),
      "second".padEnd(18),
      "─── ↓ 3 more ─────",
    ];

    const framed = frameEditorLines(
      nativeLines,
      20,
      frameData,
      footerTheme,
      plainBorder,
    );

    expect(framed[1]).toBe("│first             ▲");
    expect(framed[2]).toBe("│second            ▼");
  });

  it("includes optional usage values only when enabled", () => {
    const nativeLines = ["─".repeat(78), "─".repeat(78)];
    const usage = {
      ...frameData,
      inputTokens: 1_500,
      outputTokens: 500,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 3_000,
      totalCost: 0.25,
      showCacheTokens: true,
      showCost: true,
    };

    const bottom = frameEditorLines(
      nativeLines,
      80,
      usage,
      footerTheme,
      plainBorder,
    ).at(-1)!;

    expect(bottom).toContain("↑1.5k ↓500 R2.0k W3.0k $0.25 42%");
  });

  it("uses the frame color for status text and semantic alert colors", () => {
    const renderWithContext = (pct: string, pctValue: number) => {
      const borderCalls: string[] = [];
      const themeCalls: Array<[string, string]> = [];
      const border = (text: string) => {
        borderCalls.push(text);
        return text;
      };
      const theme = {
        fg: (color: string, text: string) => {
          themeCalls.push([color, text]);
          return text;
        },
      };

      frameEditorLines(
        ["─".repeat(78), "─".repeat(78)],
        80,
        {
          ...frameData,
          modelId: "model",
          thinkingLevel: "high",
          pct,
          pctValue,
          inputTokens: 1_500,
          outputTokens: 500,
        },
        theme,
        border,
      );

      return { borderCalls, themeCalls };
    };

    const normal = renderWithContext("42%", 42);
    expect(normal.borderCalls).toEqual(
      expect.arrayContaining(["model", "(high)", "↑1.5k", "↓500", "42%"]),
    );
    expect(normal.themeCalls).toEqual([]);

    const warning = renderWithContext("75%", 75);
    expect(warning.themeCalls).toEqual([["warning", "75%"]]);
    expect(warning.borderCalls).not.toContain("75%");

    const error = renderWithContext("95%", 95);
    expect(error.themeCalls).toEqual([["error", "95%"]]);
    expect(error.borderCalls).not.toContain("95%");
  });

  it("never renders wider than widths from zero through 200", () => {
    for (let width = 0; width <= 200; width++) {
      const innerWidth = Math.max(1, width - 2);
      const framed = frameEditorLines(
        [
          "─".repeat(innerWidth),
          "x".padEnd(innerWidth),
          "─".repeat(innerWidth),
        ],
        width,
        frameData,
        footerTheme,
        plainBorder,
      );

      for (const line of framed) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("falls back to native output when Pi's layout is unrecognized", () => {
    const nativeLines = ["unexpected top", "content", "unexpected bottom"];

    expect(
      frameEditorLines(nativeLines, 20, frameData, footerTheme, plainBorder),
    ).toEqual(nativeLines);
  });
});

describe("getRightBorderGlyph", () => {
  const scroll = {
    hiddenAbove: true,
    hiddenBelow: true,
    contentLineCount: 5,
  };

  it("marks hidden content at the top and bottom of the right border", () => {
    expect(getRightBorderGlyph(0, scroll)).toBe("▲");
    expect(getRightBorderGlyph(2, scroll)).toBe("│");
    expect(getRightBorderGlyph(4, scroll)).toBe("▼");
  });

  it("renders a normal border without overflow", () => {
    expect(getRightBorderGlyph(0, null)).toBe("│");
  });
});

describe("formatStatusLine", () => {
  it("returns no lines when there are no statuses", () => {
    expect(formatStatusLine(new Map(), 80, footerTheme)).toEqual([]);
  });

  it("sorts statuses by key and joins them on a single line", () => {
    const statuses = new Map([
      ["br", "branch"],
      ["alpha", "first"],
    ]);
    expect(formatStatusLine(statuses, 80, footerTheme)).toEqual([
      "",
      "first branch",
    ]);
  });

  it("strips newlines, tabs and carriage returns, and collapses spaces", () => {
    const statuses = new Map([
      ["b", "x\ty"],
      ["a", "line1\nline2"],
      ["c", "a  b"],
    ]);
    expect(formatStatusLine(statuses, 80, footerTheme)).toEqual([
      "",
      "line1 line2 x y a b",
    ]);
  });

  it("drops statuses that are only whitespace", () => {
    expect(
      formatStatusLine(
        new Map([
          ["a", " \n	 "],
          ["b", "ok"],
        ]),
        80,
        footerTheme,
      ),
    ).toEqual(["", "ok"]);
    expect(formatStatusLine(new Map([["a", " \n	 "]]), 80, footerTheme)).toEqual(
      [],
    );
  });

  it("truncates the joined line to the terminal width", () => {
    const statuses = new Map([["a", "hello world"]]);
    // truncateToWidth appends ANSI resets around the truncation point
    expect(formatStatusLine(statuses, 5, footerTheme)).toEqual([
      "",
      "he\u001b[0m...\u001b[0m",
    ]);
  });
});
