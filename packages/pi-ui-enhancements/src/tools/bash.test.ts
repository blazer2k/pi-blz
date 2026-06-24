import { describe, expect, it } from "bun:test";
import { patchBashTool } from "./bash";
import { clearBlinkTimers } from "./tool-rendering";
import { mkTheme, mkToolCtx, setupTool } from "../test-helpers";

function setupBashTool() {
  return setupTool(patchBashTool);
}

describe("bash renderCall", () => {
  it("collapses whitespace when not expanded", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ expanded: false });

    const component = renderCall(
      { command: "echo   hello\npwd", timeout: 10 },
      theme,
      ctx,
    );

    const text = component.render(120).join("\n");
    expect(text).toContain("echo hello");
    expect(text).not.toContain("echo   hello\npwd");
  });

  it("preserves command when expanded", () => {
    const def = setupBashTool();
    const renderCall = def.renderCall!;
    const theme = mkTheme();
    const ctx = mkToolCtx({ expanded: true });

    const component = renderCall(
      { command: "echo   hello\npwd", timeout: 10 },
      theme,
      ctx,
    );

    const text = component.render(120).join("\n");
    expect(text).toContain("echo   hello");
    expect(text).toContain("pwd");
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
    expect(output).toContain("└─ L10");
    expect(output).toContain("5 more lines");
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
        details: { durationMs: 123 },
      },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    );

    const output = component.render(120).join("\n");
    expect(output).toContain("took 123ms, error");
    expect(output).toContain("3 more lines");
    const lines = output.split("\n");
    expect(
      lines.some((l) => l.includes("│  line1") || l.includes("└─ line1")),
    ).toBe(false);
    expect(
      lines.some((l) => l.includes("│  line3") || l.includes("└─ line3")),
    ).toBe(false);
    expect(output).toContain("│  line4");
    expect(output).toContain("└─ line8");
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
