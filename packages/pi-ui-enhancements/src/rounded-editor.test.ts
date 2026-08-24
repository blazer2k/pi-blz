import { describe, expect, it } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  type EditorFrameData,
  frameEditorLines,
  formatStatusLine,
  formatTokens,
  getRightBorderGlyph,
  getTotalUsage,
  registerRoundedEditor,
} from "./rounded-editor";

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
      `${"─".repeat(9)} ↑`,
      "first".padEnd(18),
      "second".padEnd(18),
      `${"─".repeat(9)} ↓`,
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
});

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

describe("registerRoundedEditor", () => {
  it("owns and restores the editor and footer lifecycle", async () => {
    const handlers: Record<string, () => Promise<void>> = {};
    const pi = {
      on: (event: string, handler: () => Promise<void>) => {
        handlers[event] = handler;
      },
      getThinkingLevel: () => "off",
    } as unknown as ExtensionAPI;
    const previousEditor = () => ({ render: () => [] });
    let editorFactory: Function = previousEditor;
    let footerFactory: Function | undefined;
    let footerCleared = false;
    let renderRequests = 0;
    let reregister: (() => void) | undefined;
    const ctx = {
      cwd: "/repo",
      model: undefined,
      getContextUsage: () => undefined,
      sessionManager: { getEntries: () => [] },
      ui: {
        theme: {
          fg: (_color: string, text: string) => text,
          getThinkingBorderColor: () => (text: string) => text,
          getBashModeBorderColor: () => (text: string) => text,
        },
        getEditorComponent: () => editorFactory,
        setEditorComponent: (factory: Function) => {
          editorFactory = factory;
        },
        setFooter: (factory: Function | undefined) => {
          footerFactory = factory;
          footerCleared = factory === undefined;
        },
      },
    } as unknown as ExtensionContext;

    const handle = registerRoundedEditor(pi, ctx, (register) => {
      reregister = register;
    });
    expect(editorFactory).not.toBe(previousEditor);

    const tui = {
      terminal: { rows: 24 },
      requestRender: () => {
        renderRequests++;
      },
    };
    const footer = footerFactory!(tui, footerTheme, {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map([["status", "ready"]]),
      onBranchChange: () => () => {},
    });
    expect(footer.render(80)).toEqual(["", "ready"]);

    const editor = editorFactory(
      tui,
      { borderColor: plainBorder, selectList: {} },
      { matches: () => false },
    );
    expect(editor.render(40).join("\n")).toContain("/repo (main)");

    await handlers.agent_end!();
    expect(renderRequests).toBeGreaterThan(0);

    editorFactory = previousEditor;
    reregister!();
    expect(editorFactory).not.toBe(previousEditor);

    handle.dispose();
    expect(editorFactory).toBe(previousEditor);
    expect(footerCleared).toBe(true);
  });
});
