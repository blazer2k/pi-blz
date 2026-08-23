import { afterEach, describe, expect, it } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
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
    expect(output).toContain("│  L06");
    expect(output).toContain("╰─ L10");
    expect(output).toContain("5 more lines");
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
    expect(output).toContain("╰─ L10");
    expect(output).toContain("9 more lines");
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
    expect(output).not.toContain("Command exited with code 3");
    expect(output).toContain("4 lines");
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
            text: "(no output)\n\nCommand exited with code 1\nreal error here",
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
    expect(output).toContain("real error here");
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
            text: Array.from({ length: 8 }, (_, i) => `line${i + 1}`).join(
              "\n",
            ),
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
    expect(output).toContain("took 123ms • truncated • 3 more lines");
    expect(output).not.toContain("error •");
    const lines = output.split("\n");
    expect(
      lines.some((l) => l.includes("│  line1") || l.includes("╰─ line1")),
    ).toBe(false);
    expect(
      lines.some((l) => l.includes("│  line3") || l.includes("╰─ line3")),
    ).toBe(false);
    expect(output).toContain("│  line4");
    expect(output).toContain("╰─ line8");
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
