import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  InteractiveMode,
  initTheme,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container, type Component, type TUI } from "@earendil-works/pi-tui";
import { createInteractiveTuiReference } from "../../../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/tui-renderer.js";
import type { Handle } from "../../shared/handle";
import { isFullscreenTui, registerTuiCapture } from "./tui-runtime";

type WidgetFactory = NonNullable<
  Parameters<ExtensionContext["ui"]["setWidget"]>[1]
>;
type WidgetOptions = Parameters<ExtensionContext["ui"]["setWidget"]>[2];
type Widget = Component & { dispose?(): void };
type WidgetHost = {
  ui: TUI;
  extensionWidgetsAbove: Map<string, Widget>;
  extensionWidgetsBelow: Map<string, Widget>;
  widgetContainerAbove: Container;
  widgetContainerBelow: Container;
  setExtensionWidget(
    key: string,
    content: string[] | WidgetFactory | undefined,
    options?: WidgetOptions,
  ): void;
};
const handles: Handle[] = [];
beforeEach(() => initTheme("dark", false));
afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
});

function widgetHost(initialMode: TUI["mode"] = "fullscreen") {
  let mode = initialMode;
  const tui = {
    get mode() {
      return mode;
    },
    requestRender() {},
  } as TUI;
  // Exercise Pi's widget registration without starting an agent session.
  const host = Object.assign(Object.create(InteractiveMode.prototype), {
    ui: tui,
    extensionWidgetsAbove: new Map<string, Widget>(),
    extensionWidgetsBelow: new Map<string, Widget>(),
    widgetContainerAbove: new Container(),
    widgetContainerBelow: new Container(),
  }) as WidgetHost;
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget: (
        key: string,
        content: string[] | WidgetFactory | undefined,
        options?: WidgetOptions,
      ) => host.setExtensionWidget(key, content, options),
    },
  } as unknown as ExtensionContext;
  const register = () => {
    const handle = registerTuiCapture(ctx);
    handles.push(handle);
    return handle;
  };
  return { host, ctx, register, setMode: (next: TUI["mode"]) => (mode = next) };
}

describe("tool-rendering TUI capture", () => {
  it("defaults to regular when no TUI is captured", () => {
    expect(isFullscreenTui()).toBe(false);
  });

  it("reads the live mode rather than caching the initial value", () => {
    const { register, setMode } = widgetHost("regular");
    register();
    expect(isFullscreenTui()).toBe(false);
    setMode("fullscreen");
    expect(isFullscreenTui()).toBe(true);
    setMode("regular");
    expect(isFullscreenTui()).toBe(false);
  });

  it("follows renderer replacements through Pi's stable TUI reference", () => {
    const { host, register } = widgetHost();
    let renderer = { mode: "regular", requestRender() {} } as TUI;
    host.ui = createInteractiveTuiReference(() => renderer);
    register();
    expect(isFullscreenTui()).toBe(false);
    renderer = { mode: "fullscreen", requestRender() {} } as TUI;
    expect(isFullscreenTui()).toBe(true);
    renderer = { mode: "regular", requestRender() {} } as TUI;
    expect(isFullscreenTui()).toBe(false);
  });

  for (const mode of ["regular", "fullscreen"] as const) {
    it(`adds no rows or spacing and preserves other ${mode} widgets`, () => {
      const { host, register } = widgetHost(mode);
      host.setExtensionWidget("above", ["existing above"]);
      host.setExtensionWidget("below", ["existing below"], {
        placement: "belowEditor",
      });
      const above = host.widgetContainerAbove.render(40);
      const below = host.widgetContainerBelow.render(40);
      const existing = host.extensionWidgetsBelow.get("below");
      const handle = register();
      const capture = host.extensionWidgetsBelow.get(
        "pi-tui-tweaks:tui-capture",
      )!;
      for (const width of [1, 40, 80, 120])
        expect(capture.render(width)).toEqual([]);
      expect(host.widgetContainerAbove.render(40)).toEqual(above);
      expect(host.widgetContainerBelow.render(40)).toEqual(below);
      expect(host.extensionWidgetsBelow.get("below")).toBe(existing);
      handle.dispose();
      expect(host.widgetContainerAbove.render(40)).toEqual(above);
      expect(host.widgetContainerBelow.render(40)).toEqual(below);
      expect(host.extensionWidgetsBelow.get("below")).toBe(existing);
      expect(isFullscreenTui()).toBe(false);
    });
  }

  it("does not add spacing to initially empty widget containers", () => {
    const { host, register } = widgetHost();
    host.setExtensionWidget("unused", undefined);
    const above = host.widgetContainerAbove.render(40);
    const below = host.widgetContainerBelow.render(40);
    const handle = register();
    expect(host.widgetContainerAbove.render(40)).toEqual(above);
    expect(host.widgetContainerBelow.render(40)).toEqual(below);
    handle.dispose();
    expect(host.widgetContainerAbove.render(40)).toEqual(above);
    expect(host.widgetContainerBelow.render(40)).toEqual(below);
  });

  it("cleans up idempotently and permits capture after reinstall", () => {
    const { host, register } = widgetHost();
    const handle = register();
    expect(isFullscreenTui()).toBe(true);
    handle.dispose();
    handle.dispose();
    expect(host.extensionWidgetsBelow.size).toBe(0);
    expect(isFullscreenTui()).toBe(false);
    register();
    expect(isFullscreenTui()).toBe(true);
  });

  it("does not remove a newer widget or clear its capture during stale disposal", () => {
    const { host, register } = widgetHost();
    const old = register();
    const oldWidget = host.extensionWidgetsBelow.get(
      "pi-tui-tweaks:tui-capture",
    )!;
    register();
    const latest = host.extensionWidgetsBelow.get("pi-tui-tweaks:tui-capture");
    oldWidget.dispose?.();
    old.dispose();
    expect(host.extensionWidgetsBelow.size).toBe(1);
    expect(host.extensionWidgetsBelow.get("pi-tui-tweaks:tui-capture")).toBe(
      latest,
    );
    expect(isFullscreenTui()).toBe(true);
  });

  it("clears capture even if widget removal fails", () => {
    const { ctx, register } = widgetHost();
    const handle = register();
    ctx.ui.setWidget = () => {
      throw new Error("widget removal failed");
    };
    expect(() => handle.dispose()).toThrow("widget removal failed");
    expect(isFullscreenTui()).toBe(false);
  });

  it("clears capture when Pi disposes the widget", () => {
    const { host, register } = widgetHost();
    register();
    host.setExtensionWidget("pi-tui-tweaks:tui-capture", undefined);
    expect(isFullscreenTui()).toBe(false);
  });
});
