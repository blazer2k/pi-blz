import { afterEach, describe, expect, it } from "bun:test";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { saveConfig } from "../config";
import { patchBashTool } from "./bash";
import { clearBlinkTimers } from "./tool-rendering";
import { mkTheme, mkToolCtx, setupTool } from "../test-helpers";

function setupBashTool() {
  return setupTool(patchBashTool);
}

describe("bash renderCall", () => {
  it("collapses whitespace and renders timeout as dim", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const ctx = mkToolCtx({ expanded: false });

    const component = renderCall(
      { command: "echo   hello\npwd", timeout: 10 },
      theme,
      ctx,
    );

    const text = component.render(120).join("\n");
    expect(text).toContain("echo hello");
    expect(text).toContain("dim: (timeout 10s)");
    expect(text).not.toContain("echo   hello\npwd");
  });

  it("expands the full command with connected continuation lines", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ expanded: true });
    const command =
      "echo   hello with a command long enough to wrap across rows\npwd && printf done";

    const component = renderCall({ command, timeout: 10 }, theme, ctx);
    const lines = component
      .render(36)
      .map((line) => line.trimEnd().slice(1))
      .filter(Boolean);

    expect(lines.join("\n")).toContain("echo   hello");
    expect(lines.join("\n")).toContain("printf done");
    expect(lines.slice(1).every((line) => line.startsWith("│  "))).toBe(true);
    expect(lines.join("\n")).not.toContain("...");
  });

  it("preserves command boundaries and safe whitespace when expanded", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const component = renderCall(
      { command: "first command\r\n\tsecond command", timeout: 30 },
      mkTheme(),
      mkToolCtx({ expanded: true }),
    );
    const lines = component.render(120).map((line) => line.trimEnd());

    expect(lines.some((line) => line.includes("first command"))).toBe(true);
    expect(lines.some((line) => line.includes("│   second command"))).toBe(
      true,
    );
  });

  it("keeps an expanded timeout suffix intact", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const component = renderCall(
      {
        command:
          "printf 'a command whose final source line is deliberately long enough to force its timeout onto a separate row'",
        timeout: 30,
      },
      mkTheme(),
      mkToolCtx({ expanded: true }),
    );
    const lines = component.render(120).map((line) => line.trimEnd());

    expect(lines.filter((line) => line.includes("(timeout 30s)"))).toHaveLength(
      1,
    );
  });

  it("renders incomplete partial args without throwing", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ isPartial: true, argsComplete: false });

    const component = renderCall({}, theme, ctx);
    const text = component.render(120).join("\n");
    expect(text).toContain("Bash");
    expect(text).toContain("...");
  });
});

describe("bash renderResult", () => {
  it("shows duration in result", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "hello" }],
        details: { durationMs: 1200 },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("took 1.2s");
  });

  it("retains duration when execution throws", async () => {
    const def = setupBashTool();
    const execute = def.execute!;
    let errorText = "";

    try {
      await execute(
        "failed-call",
        { command: "exit 4" },
        undefined,
        undefined,
        { cwd: process.cwd() } as ExtensionContext,
      );
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
    }

    const component = def.renderResult!(
      { content: [{ type: "text", text: errorText }], details: undefined },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx({
        toolCallId: "failed-call",
        isError: true,
        state: {},
      }),
    );

    expect(component.render(120).join("\n")).toContain("took ");
  });

  it("puts duration before truncation metadata", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [{ type: "text", text: "hello" }],
        details: {
          durationMs: 50,
          truncation: { truncated: true },
        },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("took 50ms • truncated");
  });

  it("omits error metadata from single-line and expanded errors", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();

    for (const expanded of [false, true]) {
      const ctx = mkToolCtx({ isError: true, expanded });
      const component = renderResult(
        {
          content: [{ type: "text", text: "failure" }],
          details: {
            durationMs: 50,
            truncation: { truncated: true },
          },
        },
        { expanded, isPartial: false },
        theme,
        ctx,
      );

      const output = component.render(120).join("\n");
      expect(output).toContain("took 50ms • truncated");
      expect(output).not.toContain("error •");
    }
  });

  it("omits an empty metadata row from short multi-line errors", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();

    for (const expanded of [false, true]) {
      const ctx = mkToolCtx({ isError: true, expanded });
      const component = renderResult(
        {
          content: [
            {
              type: "text",
              text: "line one\nline two\nline three\nCommand exited with code 3",
            },
          ],
          details: {},
        },
        { expanded, isPartial: false },
        theme,
        ctx,
      );

      const output = component.render(120).join("\n");
      expect(output).not.toContain("├─");
      expect(output).toContain("│  line one");
      expect(output).toContain("╰─ Command exited with code 3");
    }
  });

  it("collapsed output shows last five lines", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 10 },
              (_, i) => `L${String(i + 1).padStart(2, "0")}`,
            ).join("\n"),
          },
        ],
        details: { durationMs: 50 },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).not.toContain("L01");
    expect(output).not.toContain("L05");
    expect(output).toContain("┊  5 more lines");
    expect(output).toContain("│  L06");
    expect(output).not.toContain("┊  L06");
    expect(output).toContain("╰─ L10");
  });

  afterEach(() => {
    saveConfig("bashMaxCollapsedLines", "5");
  });

  it("collapsed output shows metadata only when the limit is 0", () => {
    saveConfig("bashMaxCollapsedLines", "0");
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 10 },
              (_, i) => `L${String(i + 1).padStart(2, "0")}`,
            ).join("\n"),
          },
        ],
        details: { durationMs: 50 },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).not.toContain("L01");
    expect(output).not.toContain("L10");
    expect(output).toContain("10 lines");
    expect(output).not.toContain("┊");
  });

  it("collapsed output shows only the last line when the limit is 1", () => {
    saveConfig("bashMaxCollapsedLines", "1");
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx();

    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: Array.from(
              { length: 10 },
              (_, i) => `L${String(i + 1).padStart(2, "0")}`,
            ).join("\n"),
          },
        ],
        details: { durationMs: 50 },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).not.toContain("L09");
    expect(output).toContain("┊  9 more lines");
    expect(output).toContain("╰─ L10");
  });

  it("shows a standalone hint when collapsed output has no metadata", () => {
    saveConfig("bashMaxCollapsedLines", "1");
    const def = setupBashTool();
    const component = def.renderResult!(
      {
        content: [{ type: "text", text: "first line\nlast line" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      mkToolCtx(),
    );

    const output = component.render(120).join("\n");
    const summaryLine = output.split("\n").find((line) => line.includes("├─"));
    expect(summaryLine).toContain("to expand");
    expect(summaryLine).not.toContain("•");
  });

  it("omits the hint separator when a collapsed error has no metadata", () => {
    saveConfig("bashMaxCollapsedLines", "1");
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();

    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: "first detail\nlast detail\nCommand exited with code 1",
          },
        ],
        details: {},
      },
      { expanded: false, isPartial: false },
      theme,
      mkToolCtx({ isError: true }),
    );

    const output = component.render(120).join("\n");
    const summaryLine = output.split("\n").find((line) => line.includes("├─"));
    expect(summaryLine).toContain("to expand");
    expect(summaryLine).not.toContain("•");
    expect(output).toContain("┊  1 more line");
    expect(output).toContain("│  last detail");
    expect(output).toContain("╰─ Command exited with code 1");
  });

  it("collapsed errors show metadata only when the limit is 0", () => {
    saveConfig("bashMaxCollapsedLines", "0");
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ isError: true });

    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: "line one\nline two\nline three\nCommand exited with code 3",
          },
        ],
        details: { durationMs: 50 },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).not.toContain("line one");
    expect(output).not.toContain("line three");
    expect(output).toContain("╰─ Command exited with code 3");
    expect(output).toContain("3 lines");
    expect(output).not.toContain("┊");
  });

  it("does not duplicate a truncated call in expanded results", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const state = {
      callTruncated: true,
      fullCommand: "echo a command that used to be duplicated",
    };
    const ctx = mkToolCtx({ expanded: true, state });

    const component = renderResult(
      {
        content: [{ type: "text", text: "done" }],
        details: { durationMs: 50 },
      },
      { expanded: true, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).not.toContain("$ echo");
    expect(output).toContain("done");
  });

  it("expanded result shows collapse hint, disabled hides both hints", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const tenLines = Array.from(
      { length: 10 },
      (_, i) => `L${String(i + 1).padStart(2, "0")}`,
    ).join("\n");

    const expanded = renderResult(
      {
        content: [{ type: "text", text: tenLines }],
        details: { durationMs: 50 },
      },
      { expanded: true, isPartial: false },
      theme,
      mkToolCtx({ expanded: true }),
    );
    expect(expanded.render(120).join("\n")).toContain("to collapse");

    const expandedSingleLine = renderResult(
      {
        content: [{ type: "text", text: "done" }],
        details: { durationMs: 50 },
      },
      { expanded: true, isPartial: false },
      theme,
      mkToolCtx({ expanded: true }),
    );
    expect(expandedSingleLine.render(120).join("\n")).toContain("to collapse");

    saveConfig("showExpansionHint", "false");
    try {
      const collapsed = renderResult(
        {
          content: [{ type: "text", text: tenLines }],
          details: { durationMs: 50 },
        },
        { expanded: false, isPartial: false },
        theme,
        mkToolCtx(),
      );
      expect(collapsed.render(120).join("\n")).not.toContain("to expand");

      const expandedDisabled = renderResult(
        {
          content: [{ type: "text", text: tenLines }],
          details: { durationMs: 50 },
        },
        { expanded: true, isPartial: false },
        theme,
        mkToolCtx({ expanded: true }),
      );
      expect(expandedDisabled.render(120).join("\n")).not.toContain(
        "to collapse",
      );
    } finally {
      saveConfig("showExpansionHint", "true");
    }
  });

  it("keeps tree prefixes on wrapped expanded output", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ expanded: true });

    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: [
              "first output line that wraps across several visual rows",
              "second output line that also wraps across several visual rows",
            ].join("\n"),
          },
        ],
        details: { durationMs: 50 },
      },
      { expanded: true, isPartial: false },
      theme,
      ctx,
    );

    const lines = component
      .render(36)
      .map((line) => line.trimEnd().slice(1))
      .filter(Boolean);

    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every((line) => /^[├│╰]/u.test(line))).toBe(true);
    expect(lines.at(-1)).toStartWith("╰─ ");
  });

  it("renders recognized status-only failures compactly", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;

    for (const status of [
      "Command timed out after 1 seconds",
      "Command aborted",
    ]) {
      const component = renderResult(
        { content: [{ type: "text", text: status }], details: {} },
        { expanded: false, isPartial: false },
        mkTheme(),
        mkToolCtx({ isError: true }),
      );
      const output = component.render(120).join("\n");

      expect(output).toContain(`╰─ ${status}`);
      expect(output).not.toContain("ctrl+o");
    }
  });

  it('error strips noisy "no output" prefix', () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ isError: true });

    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: "(no output)\n\nCommand exited with code 1",
          },
        ],
        details: { durationMs: 50 },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).not.toContain("(no output)");
    expect(output).toContain("Command exited with code 1");
  });

  it("colors command output normally and only the status as an error", () => {
    saveConfig("bashMaxCollapsedLines", "1");
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: "detail one\ndetail two\nCommand exited with code 9",
          },
        ],
        details: {},
      },
      { expanded: true, isPartial: false },
      theme,
      mkToolCtx({ isError: true, expanded: true }),
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("toolOutput:detail one");
    expect(output).toContain("toolOutput:detail two");
    expect(output).not.toContain("error:detail one");
    expect(output).toContain("error:Command exited with code 9");
    expect(output).toContain("to collapse");
  });

  it("keeps unknown execution errors fully red", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `${color}:${text}`,
    } as Theme;
    const component = renderResult(
      {
        content: [{ type: "text", text: "shell setup failed" }],
        details: {},
      },
      { expanded: false, isPartial: false },
      theme,
      mkToolCtx({ isError: true }),
    );

    expect(component.render(120).join("\n")).toContain(
      "error:shell setup failed",
    );
  });

  it("uses a separate metadata row for long expanded single-line output", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: "a deliberately long output line that cannot share one row with duration metadata and the complete collapse hint without wrapping badly",
          },
        ],
        details: { durationMs: 50 },
      },
      { expanded: true, isPartial: false },
      mkTheme(),
      mkToolCtx({ expanded: true }),
    );
    const lines = component
      .render(120)
      .map((line) => line.trimEnd())
      .filter(Boolean);

    const metadataLine = lines.find((line) => line.includes("took 50ms"));
    expect(metadataLine).toContain("to collapse");
    expect(lines.at(-1)).not.toContain("collapse");
  });

  it("uses the last nonempty tail line while output is partial", () => {
    saveConfig("bashMaxCollapsedLines", "1");
    const def = setupBashTool();
    const component = def.renderResult!(
      {
        content: [{ type: "text", text: "line one\nline two\n\n" }],
        details: { durationMs: 3400 },
      },
      { expanded: false, isPartial: true },
      mkTheme(),
      mkToolCtx({ isPartial: true }),
    );
    const output = component.render(120).join("\n");

    expect(output).toContain("elapsed 3.4s");
    expect(output).toContain("to expand");
    expect(output).toContain("┊  1 more line");
    expect(output).toContain("╰─ line two");
  });

  it("collapsed errors render a summary plus the last 5 prefixed lines", () => {
    const def = setupBashTool();
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ isError: true });

    const component = renderResult(
      {
        content: [
          {
            type: "text",
            text: `${Array.from({ length: 8 }, (_, i) => `line${i + 1}`).join(
              "\n",
            )}\nCommand exited with code 2`,
          },
        ],
        details: {
          durationMs: 123,
          truncation: { truncated: true },
        },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("took 123ms • truncated");
    expect(output).not.toContain("error •");
    const lines = output.split("\n");
    expect(
      lines.some((l) => l.includes("│  line1") || l.includes("╰─ line1")),
    ).toBe(false);
    expect(
      lines.some((l) => l.includes("│  line3") || l.includes("╰─ line3")),
    ).toBe(false);
    expect(output).toContain("┊  3 more lines");
    expect(output).toContain("│  line4");
    expect(output).toContain("│  line8");
    expect(output).toContain("╰─ Command exited with code 2");
  });
});

describe("bash partial duration timer", () => {
  it("starts timer on partial result and clears it on final", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const state: Record<string, unknown> = {};
    const ctx = mkToolCtx({ executionStarted: true, isPartial: true, state });

    renderCall({ command: "sleep 10" }, theme, ctx);

    // Partial render should set a duration timer on state
    renderResult(
      {
        content: [{ type: "text", text: "..." }],
        details: {},
      },
      { expanded: false, isPartial: true },
      theme,
      ctx,
    );
    expect(state.durationTimer).toBeDefined();

    // Final render should clear it
    renderResult(
      {
        content: [{ type: "text", text: "done" }],
        details: { durationMs: 100 },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );
    expect(state.durationTimer).toBeUndefined();

    clearBlinkTimers();
  });

  it("keeps status blinking for partial results until final result", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const renderResult = def.renderResult!;
    const theme = mkTheme();
    const state: Record<string, unknown> = {};
    const ctx = mkToolCtx({ executionStarted: true, isPartial: true, state });

    renderCall({ command: "sleep 10" }, theme, ctx);
    expect(state.blinkTimer).toBeDefined();

    renderResult(
      {
        content: [{ type: "text", text: "still running" }],
        details: {},
      },
      { expanded: false, isPartial: true },
      theme,
      ctx,
    );
    expect(state.hasResult).toBe(false);

    renderCall({ command: "sleep 10" }, theme, ctx);
    expect(state.blinkTimer).toBeDefined();

    renderResult(
      {
        content: [{ type: "text", text: "done" }],
        details: { durationMs: 100 },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );
    expect(state.hasResult).toBe(true);

    renderCall({ command: "sleep 10" }, theme, { ...ctx, isPartial: false });
    expect(state.blinkTimer).toBeUndefined();

    clearBlinkTimers();
  });
});
