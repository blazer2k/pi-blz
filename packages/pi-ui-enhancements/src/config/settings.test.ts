import { describe, expect, it } from "bun:test";
import { getConfig, type ConfigKey } from "../config";
import { applyConfigUpdate, getDefaultConfig } from "./definition";
import { getSettingItems } from "./settings";

describe("getSettingItems", () => {
  it("defines every config key exactly once", () => {
    const config = getConfig();
    const configKeys = Object.keys(config) as ConfigKey[];
    const settingIds = getSettingItems(config).map((item) => item.id);

    expect(new Set(settingIds)).toEqual(new Set(configKeys));
    expect(settingIds).toHaveLength(configKeys.length);
  });

  it("reads current values from the supplied config", () => {
    const config = {
      ...getConfig(),
      asciiHeaderEnabled: false,
      maxCallWidth: 160,
      roundedEditorColor: "muted" as const,
    };
    const items = getSettingItems(config);

    expect(
      Object.fromEntries(items.map((item) => [item.id, item.currentValue])),
    ).toMatchObject({
      asciiHeaderEnabled: "false",
      maxCallWidth: "160",
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
