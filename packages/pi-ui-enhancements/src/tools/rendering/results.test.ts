import { describe, expect, it } from "bun:test";
import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  formatErrorBody,
  formatListResult,
  formatSimpleErrorResult,
} from "./results";
import { extractTextContent } from "./text";
import type {
  BaseRenderState,
  ListResultConfig,
  ResultStatusState,
} from "./types";
import { mkTheme } from "../../test-helpers";

const opts: ToolRenderResultOptions = { expanded: false, isPartial: false };
const optsExpanded: ToolRenderResultOptions = {
  expanded: true,
  isPartial: false,
};

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
    expect(truncated).toBe(true);
    expect(text).toBe("line1 ...");
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

  it("shows truncation without error metadata", () => {
    const theme = mkTheme();
    const state: BaseRenderState = { isError: true, truncated: true };

    for (const options of [opts, optsExpanded]) {
      const output = formatSimpleErrorResult(
        "something went wrong",
        state,
        options,
        theme,
      );
      expect(output).toContain("truncated");
      expect(output).not.toContain("error •");
    }
  });

  it("renders one-line collapsed previews and restores tree rows when expanded", () => {
    const theme = mkTheme();
    const state: BaseRenderState = { isError: true };
    const error = "rg: regex parse error:\n    (?:[)\n       ^";

    const collapsed = formatSimpleErrorResult(error, state, opts, theme);
    expect(collapsed).toContain("╰─ rg: regex parse error: ...");
    expect(collapsed).toContain("to expand");
    expect(collapsed.split("\n")).toHaveLength(1);

    const expanded = formatSimpleErrorResult(error, state, optsExpanded, theme);
    expect(expanded).toContain("├─ ");
    expect(expanded).toContain("to collapse");
    expect(expanded).toContain("│      (?:[)");
    expect(expanded).toContain("╰─        ^");
  });

  it("labels empty errors without offering expansion", () => {
    const output = formatSimpleErrorResult(
      "",
      { isError: true },
      opts,
      mkTheme(),
    );
    expect(output).toContain("╰─ error");
    expect(output).not.toContain("ctrl+o");
  });
});

const baseConfig: ListResultConfig = {
  emptyMessage: "(empty)",
  singularLabel: "file",
  pluralLabel: "files",
  moreLabel: "more files",
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

  it("colors counts as muted and omits redundant result limits", () => {
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const state = resultStatusState();
    const result = {
      content: [{ type: "text", text: "a.txt\nb.txt" }],
      details: { resultLimitReached: 1000 },
    };
    const output = formatListResult(result, state, opts, theme, baseConfig);
    expect(output).toContain("muted:2 files");
    expect(output).not.toContain("1000 limit");
  });

  it("puts truncation before count metadata", () => {
    const theme = mkTheme();
    const state = resultStatusState({ truncated: true });
    const result = {
      content: [{ type: "text", text: "a.txt\nb.txt" }],
      details: { resultLimitReached: 1000 },
    };
    const output = formatListResult(result, state, opts, theme, baseConfig);
    expect(output).toContain("truncated • 2 files");
    expect(output).not.toContain("1000 limit");
  });

  it("keeps the connector dim regardless of truncation", () => {
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
    ).toContain("dim:╰─ ");

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
