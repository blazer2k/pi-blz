import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getConfig, loadConfig, saveConfig } from "./config";

let configDir: string;
let previousConfigPath: string | undefined;

beforeEach(() => {
  previousConfigPath = process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  configDir = mkdtempSync(join(tmpdir(), "pi-ui-enhancements-config-"));
  process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = join(configDir, "settings.json");
  loadConfig();
});

afterEach(() => {
  if (previousConfigPath === undefined) {
    delete process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  } else {
    process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = previousConfigPath;
  }
  rmSync(configDir, { recursive: true, force: true });
  loadConfig();
});

describe("tool patch config", () => {
  it("defaults to essential built-in tools", () => {
    expect(getConfig().patchedBuiltInTools).toBe("essential");
  });

  it("saves all built-in tool patch mode", () => {
    saveConfig("patchedBuiltInTools", "all");

    expect(getConfig().patchedBuiltInTools).toBe("all");
  });

  it("rejects invalid built-in tool patch mode", () => {
    expect(() => saveConfig("patchedBuiltInTools", "invalid")).toThrow(
      "Invalid config update",
    );
  });
});

describe("config numeric values", () => {
  it("rejects fractional numeric updates", () => {
    expect(() => saveConfig("maxExpandedEntries", "20.5")).toThrow(
      "Invalid config update",
    );
    expect(() => saveConfig("maxCallWidth", "80.5")).toThrow(
      "Invalid config update",
    );
  });

  it("falls back to defaults for fractional numeric values loaded from disk", () => {
    writeFileSync(
      process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH!,
      JSON.stringify({ maxCallWidth: 120.5, maxExpandedEntries: 10.5 }),
    );

    loadConfig();

    expect(getConfig().maxCallWidth).toBe(80);
    expect(getConfig().maxExpandedEntries).toBe(20);
  });
});
