import { describe, expect, it } from "bun:test";
import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  type BaseRenderState,
  type ListResultConfig,
  buildHint,
  clearBlinkTimers,
  countLines,
  extractTextContent,
  formatErrorBody,
  formatListResult,
  formatSimpleErrorResult,
  getCallRenderParts,
  getStatusColor,
  normalizeOutput,
  renderPath,
  safeTruncateToWidth,
  updateResultState,
} from "./tool-rendering";
import { mkTheme } from "../test-helpers";

const opts: ToolRenderResultOptions = { expanded: false, isPartial: false };
const optsExpanded: ToolRenderResultOptions = {
  expanded: true,
  isPartial: false,
};

// --- tests ---

describe("normalizeOutput", () => {
  it("removes only one trailing newline", () => {
    expect(normalizeOutput("a\n")).toBe("a");
  });

  it("keeps internal newlines when two trailing", () => {
    expect(normalizeOutput("a\n\n")).toBe("a\n");
  });

  it("leaves string without trailing newline unchanged", () => {
    expect(normalizeOutput("hello")).toBe("hello");
  });
});

describe("countLines", () => {
  it("returns 0 for empty string", () => {
    expect(countLines("")).toBe(0);
  });

  it("returns 1 for single line", () => {
    expect(countLines("a")).toBe(1);
  });

  it("handles trailing newline", () => {
    expect(countLines("a\nb\n")).toBe(2);
  });
});

describe("extractTextContent", () => {
  it("joins text content and ignores non-text content", () => {
    const result = {
      content: [
        { type: "text", text: "hello" },
        { type: "image", text: "img-data" },
        { type: "text", text: "world" },
      ],
    };
    expect(extractTextContent(result)).toBe("hello\nworld");
  });

  it("returns empty string when no text content", () => {
    const result = {
      content: [{ type: "image", text: "data" }],
    };
    expect(extractTextContent(result)).toBe("");
  });
});

describe("formatErrorBody", () => {
  it("compacts long single-line errors when collapsed", () => {
    const error =
      "A very long error message that definitely exceeds the maximum allowed line width limit";
    const { text, truncated } = formatErrorBody(error, opts, "...");
    expect(truncated).toBe(true);
    expect(text).not.toBe(error);
  });

  it("marks multi-line errors as truncated even when they fit", () => {
    const error = "line1\nline2\nline3";
    const { text, truncated } = formatErrorBody(error, opts, "...");
    // multi-line errors always go through truncateToWidth path
    expect(truncated).toBe(true);
    expect(text).toBe(error);
  });

  it("preserves full error when expanded", () => {
    const error = "line1\nline2\nline3";
    const { text, truncated } = formatErrorBody(error, optsExpanded, "...");
    expect(truncated).toBe(false);
    expect(text).toBe("line1\nline2\nline3");
  });
});

describe("formatSimpleErrorResult", () => {
  it("renders error text with tree prefix", () => {
    const theme = mkTheme();
    const state: BaseRenderState = { isError: true };
    const result = {
      content: [{ type: "text", text: "something went wrong" }],
    };
    const output = formatSimpleErrorResult(
      extractTextContent(result),
      state,
      opts,
      theme,
    );
    expect(output).toContain("└─");
    expect(output).toContain("something went wrong");
  });
});

describe("renderPath", () => {
  it("renders invalid non-string args as error", () => {
    const theme = mkTheme();
    const output = renderPath(123 as unknown as string, theme, "/cwd");
    expect(output).toContain("[invalid arg]");
  });

  it("renders empty path as fallback", () => {
    const theme = mkTheme();
    const output = renderPath("", theme, "/cwd");
    expect(output).toContain("...");
  });

  it("shortens home directory paths", () => {
    const theme = mkTheme();
    const home = process.env.HOME ?? "";
    if (!home) return; // skip if HOME not set
    const output = renderPath(`${home}/foo`, theme, "/cwd");
    expect(output).toContain("~/foo");
  });

  it("does not shorten paths that only share the home prefix", () => {
    const theme = mkTheme();
    const home = process.env.HOME ?? "";
    if (!home) return; // skip if HOME not set
    const output = renderPath(`${home}2/foo`, theme, "/cwd");
    expect(output).toContain(`${home}2/foo`);
    expect(output).not.toContain("~2/foo");
  });
});

describe("safeTruncateToWidth", () => {
  it("closes open OSC-8 hyperlinks", () => {
    // OSC 8 hyperlink that is never closed
    const open = "\x1b]8;http://example.com;link\x07";
    const result = safeTruncateToWidth(open, 5, "...");
    // Should contain a closing OSC-8 terminator
    expect(result).toContain("\x1b]8;;\x07");
  });
});

describe("updateResultState", () => {
  it("returns true only when state changes", () => {
    const state: BaseRenderState = {};
    const changed = updateResultState(state, {
      hasResult: true,
      truncated: false,
      isError: false,
    });
    expect(changed).toBe(true);

    const same = updateResultState(state, {
      hasResult: true,
      truncated: false,
      isError: false,
    });
    expect(same).toBe(false);
  });
});

describe("buildHint", () => {
  it("returns expand hint", () => {
    const theme = mkTheme();
    const hint = buildHint(theme);
    expect(hint).toContain("to expand");
  });
});

describe("tool call blink rendering", () => {
  it("captures blink phase once for symbol and color", () => {
    const originalNow = Date.now;
    let calls = 0;
    Date.now = () => (calls++ === 0 ? 0 : 500);

    try {
      const theme = {
        ...mkTheme(),
        fg: (color: string, text: string) => `[${color}]${text}`,
      } as Theme;
      const state: BaseRenderState = {};
      const { prefix } = getCallRenderParts(state, theme, {
        executionStarted: true,
        isPartial: false,
        invalidate: () => {},
      });

      expect(state.blinkOn).toBe(true);
      expect(prefix).toBe("[success]● ");
    } finally {
      Date.now = originalNow;
      clearBlinkTimers();
    }
  });

  it("keeps error and truncation colors above blink status", () => {
    expect(getStatusColor(false, { isError: true }, true)).toBe("error");
    expect(getStatusColor(false, { truncated: true }, true)).toBe("warning");
    expect(getStatusColor(true, { isError: true }, true)).toBe("error");
    expect(getStatusColor(true, { truncated: true }, true)).toBe("warning");
  });
});

// --- formatListResult tests ---

const baseConfig: ListResultConfig = {
  emptyMessage: "(empty)",
  singularLabel: "file",
  pluralLabel: "files",
  moreLabel: "more files",
  details: { limitKey: "resultLimitReached" },
  preprocess: (text) => text.split("\n").filter((l) => l.length > 0),
};

describe("formatListResult", () => {
  it("renders empty message", () => {
    const theme = mkTheme();
    const state: BaseRenderState = {};
    const result = {
      content: [{ type: "text", text: "(empty)" }],
    };
    const output = formatListResult(result, state, opts, theme, baseConfig);
    expect(output).toContain("└─");
    expect(output).toContain("(empty)");
  });

  it("collapsed shows count and expand hint", () => {
    const theme = mkTheme();
    const state: BaseRenderState = {};
    const result = {
      content: [{ type: "text", text: "a.txt\nb.txt\nc.txt" }],
    };
    const output = formatListResult(result, state, opts, theme, baseConfig);
    expect(output).toContain("3 files");
    expect(output).toContain("to expand");
  });

  it("expanded renders first 20 items", () => {
    const theme = mkTheme();
    const state: BaseRenderState = {};
    const lines = Array.from({ length: 25 }, (_, i) => `file${i}.txt`).join(
      "\n",
    );
    const result = {
      content: [{ type: "text", text: lines }],
    };
    const output = formatListResult(
      result,
      state,
      optsExpanded,
      theme,
      baseConfig,
    );
    expect(output).toContain("file0.txt");
    expect(output).toContain("file19.txt");
    expect(output).toContain("5 more files");
  });

  it("marks configured limit as warning", () => {
    const theme = mkTheme();
    const state: BaseRenderState = {};
    const result = {
      content: [{ type: "text", text: "a.txt\nb.txt" }],
      details: { resultLimitReached: 1000 },
    };
    const output = formatListResult(result, state, opts, theme, baseConfig);
    expect(output).toContain("1000 limit");
  });

  it("marks truncation", () => {
    const theme = mkTheme();
    const state: BaseRenderState = {};
    const result = {
      content: [{ type: "text", text: "a.txt\nb.txt" }],
      details: { truncation: { truncated: true } },
    };
    const output = formatListResult(result, state, opts, theme, baseConfig);
    expect(output).toContain("truncated");
  });
});
