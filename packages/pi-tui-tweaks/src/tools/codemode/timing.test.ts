import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../config/store";
import {
  createCodemodeExtension,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Handle } from "../../shared/handle";
import {
  mkTheme,
  mkToolCtx,
  setupCustomTool,
  setTestConfig,
} from "../../testing/helpers";
import { clearBlinkTimers, registerToolTimer } from "../rendering/state";
import type { CodemodeRenderState } from "./types";

const originalPath = process.env.PI_TUI_TWEAKS_CONFIG_PATH;
let directory: string;
let now: number;
let nextId: number;
const intervals = new Map<ReturnType<typeof setInterval>, () => void>();
const cleared: unknown[] = [];
const handles: Handle[] = [];
const originalInterval = globalThis.setInterval;
const originalClear = globalThis.clearInterval;
let clock: ReturnType<typeof spyOn>;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-tui-tweaks-codemode-timing-"));
  process.env.PI_TUI_TWEAKS_CONFIG_PATH = join(directory, "settings.json");
  loadConfig();
  clearBlinkTimers();
  now = 1000;
  nextId = 0;
  intervals.clear();
  cleared.length = 0;
  clock = spyOn(Date, "now").mockImplementation(() => now);
  globalThis.setInterval = ((callback: () => void, delay: number) => {
    expect(delay).toBe(250);
    const id = ++nextId as unknown as ReturnType<typeof setInterval>;
    intervals.set(id, callback);
    return id;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
    cleared.push(id);
    intervals.delete(id);
  }) as typeof clearInterval;
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  clearBlinkTimers();
  clock.mockRestore();
  globalThis.setInterval = originalInterval;
  globalThis.clearInterval = originalClear;
  rmSync(directory, { recursive: true, force: true });
  if (originalPath === undefined) delete process.env.PI_TUI_TWEAKS_CONFIG_PATH;
  else process.env.PI_TUI_TWEAKS_CONFIG_PATH = originalPath;
  loadConfig();
});
function setup(executionStarted = true, expanded = false) {
  let definition!: ToolDefinition;
  createCodemodeExtension()({
    registerTool(tool: ToolDefinition) {
      definition = tool;
    },
    getSettings: () => ({}),
    getAllTools: () => [],
    appendEntry() {},
  } as unknown as ExtensionAPI);
  let active = executionStarted;
  const handle = setupCustomTool(definition, () => active, undefined, {
    source: "builtin",
    path: "builtin:codemode",
    scope: "temporary",
    origin: "top-level",
  });
  handles.push(handle);
  const renderers = handle.renderers;
  const state: CodemodeRenderState = {};
  let invalidations = 0;
  const context = mkToolCtx({
    state: { _tuiTweaks: state },
    executionStarted,
    expanded,
    isPartial: true,
    invalidate: () => {
      invalidations++;
    },
  });
  const args = { code: "text(1);\ntext(2);" };
  const renderCall = () =>
    renderers.renderCall!(args, mkTheme(), context).render(120);
  const progress = () =>
    renderers.renderResult!(
      { content: [], details: { calls: [] } },
      { expanded, isPartial: true },
      mkTheme(),
      context,
    );
  renderCall();
  return {
    definition: renderers,
    handle,
    state,
    context,
    renderCall,
    progress,
    invalidations: () => invalidations,
    setActive: (value: boolean) => {
      active = value;
    },
  };
}

describe("Codemode timing", () => {
  it("keeps one duration timer and the same blink through repeated progress", () => {
    const { state, progress, renderCall, invalidations } = setup();
    const blink = state.blinkTimer;
    const component = progress();
    const timer = state.durationTimer;
    progress();
    renderCall();
    expect(state.durationTimer).toBe(timer);
    expect(intervals.size).toBe(1);
    expect(state.blinkTimer).toBe(blink);
    expect(state.hasResult).toBe(false);
    now = 2750;
    intervals.get(timer!)!();
    expect(invalidations()).toBeGreaterThan(0);
    component.invalidate();
    expect(component.render(120).join("\n")).toContain("elapsed 1.8s");
  });

  it("keeps recorded duration on settlement and stops both indicators", () => {
    const { definition, state, context, progress, renderCall } = setup();
    progress();
    const timer = state.durationTimer;
    now = 2500;
    const input = {
      content: [{ type: "text" as const, text: "done" }],
      details: { calls: [] },
    };
    const component = definition.renderResult!(
      input,
      { expanded: false, isPartial: false },
      mkTheme(),
      { ...context, isPartial: false, durationMs: 1250 },
    );
    renderCall();
    expect(state.blinkTimer).toBeUndefined();
    expect(state.durationTimer).toBeUndefined();
    expect(cleared).toContain(timer);
    expect(state.endedAt).toBe(2500);
    now = 9000;
    component.invalidate();
    expect(component.render(120).join("\n")).toContain("took 1.3s");
  });

  it("prefers recorded duration over header and observed time", () => {
    const { definition, context, progress } = setup();
    progress();
    now = 9000;
    const component = definition.renderResult!(
      {
        content: [
          {
            type: "text",
            text: "Script completed\nWall time 0.4 seconds\nOutput:\n",
          },
        ],
        details: { calls: [] },
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      { ...context, durationMs: 451 },
    );
    expect(component.render(120).join("\n")).toContain("took 451ms");
  });

  it("keeps recorded timing for zero-duration and aborted calls", () => {
    for (const expanded of [false, true]) {
      for (const isError of [false, true]) {
        const { definition, context, state, progress } = setup(true, expanded);
        progress();
        now += 5000;
        const durationMs = isError ? 600 : 0;
        const component = definition.renderResult!(
          {
            content: [
              {
                type: "text",
                text: isError ? "Script error:\nError: Script aborted" : "done",
              },
            ],
            details: { calls: [] },
          },
          { expanded, isPartial: false },
          mkTheme(),
          { ...context, isPartial: false, isError, durationMs },
        );
        now += 5000;
        const text = component.render(120).join("\n");
        expect(text).toContain(`took ${durationMs}ms`);
        expect(text.match(/\b(?:Took|took) /g)).toHaveLength(1);
        expect(state.durationTimer).toBeUndefined();
        expect(state.blinkTimer).toBeUndefined();
        if (isError) expect(text).toContain("Script aborted");
      }
    }
  });

  it("does not invent start times or duration timers for historical calls", () => {
    const { definition, state, context, progress } = setup(false);
    progress();
    expect(state.startedAt).toBeUndefined();
    expect(state.durationTimer).toBeUndefined();
    const component = definition.renderResult!(
      {
        content: [{ type: "text", text: "old output" }],
        details: { calls: [] },
      },
      { expanded: false, isPartial: false },
      mkTheme(),
      context,
    );
    expect(component.render(120).join("\n")).not.toContain("took");
    expect(state.endedAt).toBeUndefined();
  });

  it("keeps elapsed refresh active when expanded calls have no blink", () => {
    const { state, progress } = setup(true, true);
    expect(state.blinkTimer).toBeUndefined();
    progress();
    expect(intervals.size).toBe(1);
  });

  it("freezes elapsed time when authoritative activity ends before a final render", () => {
    const { state, progress, renderCall, setActive } = setup();
    progress();
    const timer = state.durationTimer;
    now = 2250;
    setActive(false);
    intervals.get(timer!)!();
    expect(state.durationTimer).toBeUndefined();
    expect(state.endedAt).toBe(2250);
    expect(cleared).toContain(timer);
    progress();
    renderCall();
    expect(intervals.size).toBe(0);
    expect(state.blinkTimer).toBeUndefined();
  });

  for (const setting of ["enabled", "enhanceCustomTools"] as const) {
    it(`cleans timers with tools.${setting}=false and resumes the same bundle when enabled`, () => {
      const { handle, state, progress } = setup();
      progress();
      const timer = state.durationTimer;
      setTestConfig({ tools: { [setting]: false } });
      handle.clearCustomTimers();
      expect(state.durationTimer).toBeUndefined();
      expect(state.blinkTimer).toBeUndefined();
      progress();
      expect(intervals.size).toBe(0);
      setTestConfig({ tools: { [setting]: true } });
      progress();
      expect(state.durationTimer).toBeDefined();
      expect(state.durationTimer).not.toBe(timer);
      expect(intervals.size).toBe(1);
      handle.dispose();
      expect(intervals.size).toBe(0);
    });
  }

  it("does not clear another instance's Codemode or unrelated Bash timers", () => {
    const { handle, progress } = setup();
    progress();
    const other = setup();
    other.progress();
    const otherTimer = other.state.durationTimer;
    const bashTimer = setInterval(() => {}, 250);
    registerToolTimer(bashTimer);
    handle.dispose();
    expect(intervals.has(bashTimer)).toBe(true);
    expect(other.state.durationTimer).toBe(otherTimer);
    expect(other.state.blinkTimer).toBeDefined();
    expect(intervals.size).toBe(2);
  });

  it("clears duration timers on errors and idempotent disposal", () => {
    const { definition, handle, state, context, progress } = setup();
    progress();
    definition.renderResult!(
      {
        content: [{ type: "text", text: "cancelled" }],
        details: { calls: [] },
      },
      { expanded: false, isPartial: true },
      mkTheme(),
      { ...context, isError: true },
    );
    expect(state.durationTimer).toBeUndefined();
    expect(intervals.size).toBe(0);
    handle.dispose();
    handle.dispose();
    expect(intervals.size).toBe(0);
    const running = setup();
    running.progress();
    const timer = running.state.durationTimer;
    clearBlinkTimers();
    expect(cleared).toContain(timer);
    expect(intervals.size).toBe(0);
  });
});
