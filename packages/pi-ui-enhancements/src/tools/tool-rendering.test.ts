import { homedir } from "node:os";
import { sep } from "node:path";
import { describe, expect, it } from "bun:test";
import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  type BaseRenderState,
  type ListResultConfig,
  type ResultStatusState,
  buildHint,
  buildResultStatusParts,
  clearBlinkTimers,
  countLines,
  extractTextContent,
  formatErrorBody,
  formatListResult,
  formatSimpleErrorResult,
  getCallRenderParts,
  getResultSymbolColor,
  getResultText,
  getStatusColor,
  normalizeOutput,
  renderPath,
  safeTruncateToWidth,
  sanitizeDisplayText,
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

describe("sanitizeDisplayText", () => {
  it("strips ANSI/OSC sequences and flattens whitespace", () => {
    expect(sanitizeDisplayText("a\x1b[31mred\x1b[0m\n\ttext")).toBe(
      "ared text",
    );
    expect(
      sanitizeDisplayText("x\x1b]8;;https://e.test\x1b\\link\x1b]8;;\x1b\\y"),
    ).toBe("xlinky");
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
    expect(output).toContain("╰─");
    expect(output).toContain("something went wrong");
  });

  it("puts error before truncation in collapsed and expanded results", () => {
    const theme = mkTheme();
    const state: BaseRenderState = { isError: true, truncated: true };

    for (const options of [opts, optsExpanded]) {
      const output = formatSimpleErrorResult(
        "something went wrong",
        state,
        options,
        theme,
      );
      expect(output).toContain("error • truncated");
    }
  });

  it("labels empty errors", () => {
    expect(
      formatSimpleErrorResult("", { isError: true }, opts, mkTheme()),
    ).toContain("╰─ error");
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
    const home = homedir();
    const output = renderPath(`${home}${sep}foo`, theme, "/cwd");
    expect(output).toContain(`~${sep}foo`);
  });

  it("supports forward slashes on Windows without treating backslashes as POSIX separators", () => {
    const theme = mkTheme();
    const home = homedir();

    if (sep === "\\") {
      expect(renderPath(`${home}/foo`, theme, "/cwd")).toContain("~/foo");
    } else {
      const siblingPath = `${home}\\foo`;
      expect(renderPath(siblingPath, theme, "/cwd")).toContain(siblingPath);
      expect(renderPath(siblingPath, theme, "/cwd")).not.toContain("~\\foo");
    }
  });

  it("does not shorten paths that only share the home prefix", () => {
    const theme = mkTheme();
    const home = homedir();
    const output = renderPath(`${home}2${sep}foo`, theme, "/cwd");
    expect(output).toContain(`${home}2${sep}foo`);
    expect(output).not.toContain(`~2${sep}foo`);
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

describe("buildResultStatusParts", () => {
  it("orders and colors statuses by connector precedence", () => {
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;

    const combinedState = { isError: true, truncated: true };
    expect(getResultSymbolColor(combinedState)).toBe("error");
    expect(buildResultStatusParts(combinedState, theme, true)).toEqual([
      "error:error",
      "warning:truncated",
    ]);

    const truncatedState = { truncated: true };
    expect(getResultSymbolColor(truncatedState)).toBe("warning");
    expect(buildResultStatusParts(truncatedState, theme)).toEqual([
      "warning:truncated",
    ]);
  });
});

describe("buildHint", () => {
  it("returns expand hint", () => {
    const theme = mkTheme();
    const hint = buildHint(theme);
    expect(hint).toContain("to expand");
  });
});

describe("tree-aware text wrapping", () => {
  it("prefixes every wrapped result row and closes only the final row", () => {
    const text = getResultText({}, optsExpanded, undefined);
    text.setText(
      "├─ summary\n╰─ a long result line that wraps across several visual rows",
    );

    const lines = text
      .render(28)
      .map((line) => line.trimEnd().slice(1))
      .filter(Boolean);

    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every((line) => /^[├│╰]/u.test(line))).toBe(true);
    expect(lines.at(-1)).toStartWith("╰─ ");
  });

  it("prefixes wrapped tree rows embedded in partial tool calls", () => {
    const { text, prefix } = getCallRenderParts({}, mkTheme(), {
      executionStarted: true,
      isPartial: true,
      invalidate: () => {},
    });
    text.setText(
      `${prefix}Write file\n╰─ a long preview line that wraps across visual rows`,
    );

    const lines = text
      .render(28)
      .map((line) => line.trimEnd().slice(1))
      .filter(Boolean);

    expect(lines.slice(1).every((line) => /^[│╰]/u.test(line))).toBe(true);
    clearBlinkTimers();
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

  it("invalidates active blinkers from one shared aligned timer", () => {
    const originalNow = Date.now;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const invalidated: string[] = [];

    Date.now = () => 100;
    globalThis.setTimeout = ((callback: () => void, delay?: number) => {
      scheduled.push({ callback, delay: delay ?? 0 });
      return { id: scheduled.length };
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = (() => {}) as unknown as typeof clearTimeout;

    try {
      const theme = mkTheme();
      for (const id of ["a", "b", "c"]) {
        getCallRenderParts({}, theme, {
          executionStarted: true,
          isPartial: false,
          invalidate: () => invalidated.push(id),
        });
      }

      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]!.delay).toBe(400);

      scheduled[0]!.callback();
      expect(invalidated).toEqual(["a", "b", "c"]);
      expect(scheduled).toHaveLength(2);
    } finally {
      Date.now = originalNow;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      clearBlinkTimers();
    }
  });

  it("renders a static pending state when animation is disabled", () => {
    const state: BaseRenderState = {};
    const { prefix } = getCallRenderParts(
      state,
      mkTheme(),
      {
        executionStarted: true,
        isPartial: true,
        invalidate: () => {},
      },
      { animate: false },
    );

    expect(prefix).toBe("○ ");
    expect(state.blinkTimer).toBeUndefined();
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

function resultStatusState(
  overrides: Partial<ResultStatusState> = {},
): ResultStatusState {
  return { truncated: false, isError: false, ...overrides };
}

describe("formatListResult", () => {
  it("renders empty message", () => {
    const theme = mkTheme();
    const state = resultStatusState();
    const result = {
      content: [{ type: "text", text: "(empty)" }],
    };
    const output = formatListResult(result, state, opts, theme, baseConfig);
    expect(output).toContain("╰─");
    expect(output).toContain("(empty)");
  });

  it("puts truncation before an empty-result message", () => {
    const output = formatListResult(
      {
        content: [{ type: "text", text: "(empty)" }],
        details: { truncation: { truncated: true } },
      },
      resultStatusState({ truncated: true }),
      opts,
      mkTheme(),
      baseConfig,
    );

    expect(output).toContain("truncated • (empty)");
  });

  it("collapsed shows count and expand hint", () => {
    const theme = mkTheme();
    const state = resultStatusState();
    const result = {
      content: [{ type: "text", text: "a.txt\nb.txt\nc.txt" }],
    };
    const output = formatListResult(result, state, opts, theme, baseConfig);
    expect(output).toContain("3 files");
    expect(output).toContain("to expand");
  });

  it("expanded renders first 20 items", () => {
    const theme = mkTheme();
    const state = resultStatusState();
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
    const state = resultStatusState();
    const result = {
      content: [{ type: "text", text: "a.txt\nb.txt" }],
      details: { resultLimitReached: 1000 },
    };
    const output = formatListResult(result, state, opts, theme, baseConfig);
    expect(output).toContain("1000 limit");
  });

  it("puts truncation before count and limit metadata", () => {
    const theme = mkTheme();
    const state = resultStatusState({ truncated: true });
    const result = {
      content: [{ type: "text", text: "a.txt\nb.txt" }],
      details: { resultLimitReached: 1000 },
    };
    const output = formatListResult(result, state, opts, theme, baseConfig);
    expect(output).toContain("truncated • 2 files • 1000 limit");
  });

  it("colors the connector from the same truncation state", () => {
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;

    expect(
      formatListResult(
        { content: [{ type: "text", text: "a.txt" }] },
        resultStatusState({ truncated: true }),
        opts,
        theme,
        baseConfig,
      ),
    ).toContain("warning:╰─ ");

    expect(
      formatListResult(
        { content: [{ type: "text", text: "a.txt" }] },
        resultStatusState(),
        opts,
        theme,
        baseConfig,
      ),
    ).toContain("dim:╰─ ");
  });
});
