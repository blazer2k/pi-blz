import { describe, expect, it } from "bun:test";
import {
  applyConfigUpdate,
  getDefaultConfig,
  type Config,
  type ConfigKey,
} from "./definition";
import { getSettingItems } from "./settings";
import { getConfig } from "./store";

describe("getSettingItems", () => {
  it("defines every config key exactly once", () => {
    const config = getConfig();
    const configKeys = Object.keys(config) as ConfigKey[];
    const settingIds = getSettingItems(config).map((item) => item.id);

    expect(new Set(settingIds)).toEqual(new Set(configKeys));
    expect(settingIds).toHaveLength(configKeys.length);
  });

  it("keeps the menu size and exposes the shared output mode", () => {
    const items = getSettingItems(getDefaultConfig());
    expect(items).toHaveLength(19);
    expect(
      items.find((item) => item.id === "collapsedOutputDisplay"),
    ).toMatchObject({
      label: "Collapsed output",
      currentValue: "preview",
      values: ["preview", "summary"],
    });
    expect(items.map((item) => item.id)).not.toContain("bashCollapsedDisplay");
  });

  it("reads current values from the supplied config", () => {
    const config: Config = {
      ...getConfig(),
      asciiHeaderEnabled: false,
      maxExpandedEntries: 100,
      roundedEditorColor: "muted",
    };
    const items = getSettingItems(config);

    expect(
      Object.fromEntries(items.map((item) => [item.id, item.currentValue])),
    ).toMatchObject({
      asciiHeaderEnabled: "false",
      maxExpandedEntries: "100",
      roundedEditorColor: "muted",
    });
  });

  it("only advertises values accepted by config validation", () => {
    let config = getDefaultConfig();

    for (const item of getSettingItems(config)) {
      for (const value of item.values ?? []) {
        expect(() => {
          config = applyConfigUpdate(config, item.id, value);
        }).not.toThrow();
      }
    }
  });
});
