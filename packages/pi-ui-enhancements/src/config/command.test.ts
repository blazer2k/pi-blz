import { describe, expect, it } from "bun:test";
import { initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import { mkTheme } from "../testing/helpers";
import type { ConfigKey } from "./definition";
import { registerConfigCommand } from "./command";
import { getSettingItems } from "./settings";
import { getConfig, saveConfig } from "./store";

type CommandDefinition = Parameters<ExtensionAPI["registerCommand"]>[1];

function setupCommand(onOpen = () => {}, onClose = () => {}) {
  let command: CommandDefinition | undefined;
  const pi = {
    registerCommand: (_name: string, definition: CommandDefinition) => {
      command = definition;
    },
  } as unknown as ExtensionAPI;

  registerConfigCommand(pi, onOpen, onClose);
  return command!;
}

describe("registerConfigCommand", () => {
  it("rejects non-TUI contexts without opening the dialog", async () => {
    const notifications: Array<[string, string]> = [];
    let opened = false;
    const command = setupCommand(() => {
      opened = true;
    });

    await command.handler("", {
      mode: "rpc",
      ui: {
        notify: (message: string, level: string) =>
          notifications.push([message, level]),
      },
    } as never);

    expect(opened).toBe(false);
    expect(notifications).toEqual([
      ["UI settings are only available in TUI mode", "error"],
    ]);
  });

  it("builds and closes the settings dialog", async () => {
    initTheme("dark");
    const events: string[] = [];
    let rendered: string[] = [];
    const command = setupCommand(
      () => events.push("open"),
      () => events.push("close"),
    );

    await command.handler("", {
      mode: "tui",
      ui: {
        notify: () => {},
        custom: async (factory: Function) => {
          const component = factory(
            {
              requestRender: () => {},
              terminal: { rows: 24 },
            },
            mkTheme(),
            { matches: () => false },
            () => {},
          );
          rendered = component.render(80);
          component.invalidate();
        },
      },
    } as never);

    expect(events).toEqual(["open", "close"]);
    expect(rendered.join("\n")).toContain("Enable ASCII header");
    expect(rendered.join("\n")).toContain("(1/21)");
  });

  it("invalidates tool renders when display settings change", async () => {
    initTheme("dark");
    const previousKeybindings = getKeybindings();
    setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
    const cases: Array<{ key: ConfigKey; invalidates: boolean }> = [
      { key: "indicatorStyle", invalidates: true },
      { key: "indicatorColor", invalidates: true },
      { key: "maxCallWidth", invalidates: true },
      { key: "maxExpandedEntries", invalidates: true },
      { key: "bashCollapsedDisplay", invalidates: true },
      { key: "showExpansionHint", invalidates: true },
      { key: "asciiHeaderEnabled", invalidates: false },
    ];

    try {
      for (const testCase of cases) {
        const originalValue = String(getConfig()[testCase.key]);
        let invalidations = 0;
        let renderRequests = 0;
        const settingIndex = getSettingItems(getConfig()).findIndex(
          (item) => item.id === testCase.key,
        );
        expect(settingIndex).toBeGreaterThanOrEqual(0);
        const command = setupCommand();

        try {
          await command.handler("", {
            mode: "tui",
            ui: {
              notify: () => {},
              custom: async (factory: Function) => {
                const component = factory(
                  {
                    invalidate: () => invalidations++,
                    requestRender: () => renderRequests++,
                    terminal: { rows: 24 },
                  },
                  mkTheme(),
                  { matches: () => false },
                  () => {},
                );
                for (let index = 0; index < settingIndex; index++) {
                  component.handleInput("\x1b[B");
                }
                component.handleInput("\r");
              },
            },
          } as never);

          expect(invalidations).toBe(testCase.invalidates ? 1 : 0);
          expect(renderRequests).toBe(
            settingIndex + 1 + (testCase.invalidates ? 1 : 0),
          );
        } finally {
          saveConfig(testCase.key, originalValue);
        }
      }
    } finally {
      setKeybindings(previousKeybindings);
    }
  });

  it("closes the dialog when the custom UI rejects", async () => {
    const events: string[] = [];
    const command = setupCommand(
      () => events.push("open"),
      () => events.push("close"),
    );

    await expect(
      command.handler("", {
        mode: "tui",
        ui: {
          notify: () => {},
          custom: async () => {
            throw new Error("dialog failed");
          },
        },
      } as never),
    ).rejects.toThrow("dialog failed");
    expect(events).toEqual(["open", "close"]);
  });
});
