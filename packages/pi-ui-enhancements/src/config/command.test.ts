import { describe, expect, it } from "bun:test";
import { initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkTheme } from "../testing/helpers";
import { registerConfigCommand } from "./command";

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
    expect(rendered.join("\n")).toContain("(1/20)");
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
