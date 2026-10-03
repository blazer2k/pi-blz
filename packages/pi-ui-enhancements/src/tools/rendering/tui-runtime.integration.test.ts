import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  createCodemodeExtension,
  initTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { Handle } from "../../shared/handle";
import { mkTheme, mkToolCtx, setupTool } from "../../testing/helpers";
import { patchBashTool } from "../bash";
import { createCodemodeDefinition } from "../codemode";
import { clearCodemodeTimers } from "../codemode/timing";
import type { CodemodeRenderState } from "../codemode/types";
import { patchWriteTool } from "../write";
import { getConfig } from "../../config/store";
import { clearBlinkTimers, getBlinkIndicator } from "./state";
import { stripAnsi } from "./text";
import { registerTuiCapture } from "./tui-runtime";
import type { BaseRenderState } from "./types";

const handles: Handle[] = [];
let clock: ReturnType<typeof spyOn>;
beforeEach(() => {
  initTheme("dark", false);
  clock = spyOn(Date, "now").mockReturnValue(1000);
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  clearCodemodeTimers();
  clearBlinkTimers();
  clock.mockRestore();
});

function capture(initial: TUI["mode"]) {
  let mode = initial;
  const tui = {
    get mode() {
      return mode;
    },
  } as TUI;
  const ctx = {
    ui: {
      setWidget(
        _key: string,
        factory: Parameters<ExtensionContext["ui"]["setWidget"]>[1],
      ) {
        if (typeof factory === "function") factory(tui, mkTheme());
      },
    },
  } as unknown as ExtensionContext;
  const handle = registerTuiCapture(ctx);
  handles.push(handle);
  return {
    handle,
    setMode: (next: TUI["mode"]) => {
      mode = next;
    },
  };
}
function codemode(active: () => boolean): ToolDefinition {
  let native!: ToolDefinition;
  createCodemodeExtension()({
    registerTool(tool: ToolDefinition) {
      native = tool;
    },
    getSettings: () => ({}),
    getAllTools: () => [],
    appendEntry() {},
  } as unknown as ExtensionAPI);
  return createCodemodeDefinition(native, {
    isToolCallActive: active,
    reportIssue: () => {},
  });
}
const cases = [
  {
    name: "bash",
    create: (_active: () => boolean) => setupTool(patchBashTool),
    args: { command: "echo first\necho last" },
  },
  {
    name: "write",
    create: (_active: () => boolean) => setupTool(patchWriteTool),
    args: { path: "file.txt", content: "first\nlast" },
  },
  { name: "codemode", create: codemode, args: { code: "text(1);\ntext(2);" } },
];
function renderer(testCase: (typeof cases)[number], executionStarted = true) {
  let active = executionStarted;
  const definition = testCase.create(() => active);
  const state: BaseRenderState = {};
  const context = mkToolCtx({
    expanded: true,
    executionStarted,
    isPartial: true,
    state: testCase.name === "codemode" ? { _uiEnhancements: state } : state,
  });
  const colors: string[] = [];
  const theme = mkTheme();
  theme.fg = (color, value) => {
    const { filled, unfilled } = getBlinkIndicator();
    if (value === `${filled} ` || value === `${unfilled} `) colors.push(color);
    return value;
  };
  const render = () => {
    colors.length = 0;
    return definition.renderCall!(testCase.args, theme, context).render(120);
  };
  return {
    definition,
    state,
    context,
    render,
    color: () => colors.at(-1),
    setActive: (next: boolean) => {
      active = next;
    },
  };
}

describe("expanded tool indicators by TUI mode", () => {
  for (const testCase of cases) {
    for (const executionStarted of [false, true]) {
      it(`blinks expanded ${testCase.name} during ${executionStarted ? "execution" : "generation"} only in fullscreen`, () => {
        const { setMode } = capture("regular");
        const { state, render, color } = renderer(testCase, executionStarted);
        render();
        expect(state.blinkTimer).toBeUndefined();
        expect(color()).toBe("dim");
        setMode("fullscreen");
        const on = render();
        const timer = state.blinkTimer;
        expect(timer).toBeDefined();
        expect(state.blinkOn).toBe(true);
        expect(color()).toBe(getConfig().indicatorColor);
        clock.mockReturnValue(1500);
        const off = render();
        expect(state.blinkTimer).toBe(timer);
        expect(state.blinkOn).toBe(false);
        expect(color()).toBe("dim");
        expect(off.length).toBe(on.length);
        expect(stripAnsi(off.join("\n"))).toContain(
          getBlinkIndicator().unfilled,
        );
        setMode("regular");
        render();
        expect(state.blinkTimer).toBeUndefined();
        expect(color()).toBe("dim");
        setMode("fullscreen");
        render();
        expect(state.blinkTimer).toBeDefined();
        expect(state.blinkTimer).not.toBe(timer);
      });
    }

    it(`keeps collapsed ${testCase.name} blinking in either mode and completed calls static`, () => {
      const { setMode } = capture("fullscreen");
      const { state, context, render, color } = renderer(testCase);
      context.expanded = false;
      render();
      const timer = state.blinkTimer;
      expect(timer).toBeDefined();
      setMode("regular");
      render();
      expect(state.blinkTimer).toBe(timer);
      state.hasResult = true;
      context.expanded = true;
      for (const mode of ["regular", "fullscreen"] as const) {
        setMode(mode);
        const output = render();
        expect(state.blinkTimer).toBeUndefined();
        expect(color()).toBe(getConfig().indicatorColor);
        expect(stripAnsi(output.join("\n"))).toContain(
          getBlinkIndicator().filled,
        );
      }
    });

    it(`returns expanded ${testCase.name} to static behavior if capture disappears`, () => {
      const { handle } = capture("fullscreen");
      const { state, render } = renderer(testCase);
      render();
      expect(state.blinkTimer).toBeDefined();
      handle.dispose();
      render();
      expect(state.blinkTimer).toBeUndefined();
    });
  }

  it("uses one blink scheduler across repeated redraws and mode switches", () => {
    const { setMode } = capture("fullscreen");
    const timeout = spyOn(globalThis, "setTimeout");
    try {
      const tools = cases.map((testCase) => renderer(testCase));
      tools.forEach((tool) => tool.render());
      const timers = tools.map((tool) => tool.state.blinkTimer);
      expect(timeout).toHaveBeenCalledTimes(1);
      for (let redraw = 0; redraw < 5; redraw++) {
        tools.forEach((tool, index) => {
          tool.render();
          expect(tool.state.blinkTimer).toBe(timers[index]);
        });
      }
      expect(timeout).toHaveBeenCalledTimes(1);
      setMode("regular");
      tools.forEach((tool) => {
        tool.render();
        expect(tool.state.blinkTimer).toBeUndefined();
      });
      setMode("fullscreen");
      tools.forEach((tool) => tool.render());
      expect(timeout).toHaveBeenCalledTimes(2);
    } finally {
      clearCodemodeTimers();
      clearBlinkTimers();
      timeout.mockRestore();
    }
  });

  it("does not restart Codemode duration timing on a mode switch", () => {
    const { setMode } = capture("fullscreen");
    const { definition, state, context, render } = renderer(cases[2]!);
    render();
    definition.renderResult!(
      { content: [], details: { calls: [] } },
      { expanded: true, isPartial: true },
      mkTheme(),
      context,
    );
    const timing = state as CodemodeRenderState;
    const timer = timing.durationTimer;
    expect(timer).toBeDefined();
    expect(timing.startedAt).toBe(1000);
    clock.mockReturnValue(2000);
    setMode("regular");
    render();
    expect(timing.durationTimer).toBe(timer);
    expect(timing.startedAt).toBe(1000);
    setMode("fullscreen");
    render();
    expect(timing.durationTimer).toBe(timer);
    expect(timing.startedAt).toBe(1000);
  });

  it("does not restart an inactive Codemode call in fullscreen", () => {
    capture("fullscreen");
    const { state, render, setActive } = renderer(cases[2]!);
    render();
    expect(state.blinkTimer).toBeDefined();
    setActive(false);
    render();
    expect(state.blinkTimer).toBeUndefined();
    render();
    expect(state.blinkTimer).toBeUndefined();
  });
});
