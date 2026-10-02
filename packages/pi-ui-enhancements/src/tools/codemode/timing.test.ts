import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  createCodemodeExtension,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Handle } from "../../shared/handle";
import { createCodemodeDefinition } from "../codemode";
import { patchCustomToolRendering } from "../custom-tools/patch-manager";
import { clearCodemodeTimers } from "./timing";
import { mkTheme, mkToolCtx } from "../../testing/helpers";
import { clearBlinkTimers, registerToolTimer } from "../rendering/state";
import type { CodemodeRenderState } from "./types";

let now: number;
let nextId: number;
const intervals = new Map<ReturnType<typeof setInterval>, () => void>();
const cleared: unknown[] = [];
const handles: Handle[] = [];
const originalInterval = globalThis.setInterval;
const originalClear = globalThis.clearInterval;
let clock: ReturnType<typeof spyOn>;
beforeEach(() => {
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
  clearCodemodeTimers();
  clearBlinkTimers();
  clock.mockRestore();
  globalThis.setInterval = originalInterval;
  globalThis.clearInterval = originalClear;
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
  const handle = patchCustomToolRendering(() => active);
  handles.push(handle);
  definition = createCodemodeDefinition(definition, {
    isToolCallActive: () => active,
    reportIssue: () => {},
  });
  const state: CodemodeRenderState = {};
  let invalidations = 0;
  const context = mkToolCtx({
    state: { _uiEnhancements: state },
    executionStarted,
    expanded,
    isPartial: true,
    invalidate: () => {
      invalidations++;
    },
  });
  const args = { code: "text(1);\ntext(2);" };
  const renderCall = () =>
    definition.renderCall!(args, mkTheme(), context).render(120);
  const progress = () =>
    definition.renderResult!(
      { content: [], details: { calls: [] } },
      { expanded, isPartial: true },
      mkTheme(),
      context,
    );
  renderCall();
  return {
    definition,
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

  it("freezes observed duration on settlement and stops both indicators", () => {
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
      { ...context, isPartial: false },
    );
    renderCall();
    expect(state.blinkTimer).toBeUndefined();
    expect(state.durationTimer).toBeUndefined();
    expect(cleared).toContain(timer);
    expect(state.endedAt).toBe(2500);
    now = 9000;
    component.invalidate();
    expect(component.render(120).join("\n")).toContain("took 1.5s");
  });

  it("prefers Pi's final reported wall time over observed time", () => {
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
      context,
    );
    expect(component.render(120).join("\n")).toContain("took 400ms");
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

  it("cleans timers on hook removal and permits resuming after reinstall", () => {
    const { handle, state, progress } = setup();
    progress();
    const timer = state.durationTimer;
    handle.dispose();
    expect(state.durationTimer).toBeUndefined();
    expect(state.blinkTimer).toBeUndefined();
    expect(intervals.size).toBe(0);
    const replacement = patchCustomToolRendering(() => true);
    handles.push(replacement);
    progress();
    expect(state.durationTimer).toBeDefined();
    expect(state.durationTimer).not.toBe(timer);
    expect(intervals.size).toBe(1);
    replacement.dispose();
    expect(intervals.size).toBe(0);
  });

  it("does not clear unrelated Bash duration timers when the hook is disposed", () => {
    const { handle, progress } = setup();
    progress();
    const bashTimer = setInterval(() => {}, 250);
    registerToolTimer(bashTimer);
    handle.dispose();
    expect(intervals.has(bashTimer)).toBe(true);
    expect(intervals.size).toBe(1);
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
