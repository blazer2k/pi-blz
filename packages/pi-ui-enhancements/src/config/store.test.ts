import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDefaultConfig } from "./definition";
import {
  clearOnConfigChange,
  getConfig,
  loadConfig,
  saveConfig,
  setOnConfigChange,
  type ConfigStorage,
} from "./store";

let configDir: string;
let previousConfigPath: string | undefined;

function createStorage(overrides: Partial<ConfigStorage> = {}): ConfigStorage {
  return {
    prepare() {},
    exists: () => true,
    read: () => "{}",
    write() {},
    ...overrides,
  };
}

beforeEach(() => {
  previousConfigPath = process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  configDir = mkdtempSync(join(tmpdir(), "pi-ui-enhancements-config-"));
  process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = join(configDir, "settings.json");
  loadConfig();
});

afterEach(() => {
  clearOnConfigChange();
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

describe("config value parsing", () => {
  it("saves boolean settings", () => {
    saveConfig("asciiHeaderEnabled", "false");
    saveConfig("roundedEditorShowCost", "true");

    expect(getConfig().asciiHeaderEnabled).toBe(false);
    expect(getConfig().roundedEditorShowCost).toBe(true);
  });

  it("saves enum settings and rejects unsupported values", () => {
    saveConfig("asciiHeaderAlign", "right");
    expect(getConfig().asciiHeaderAlign).toBe("right");

    expect(() => saveConfig("asciiHeaderAlign", "justify")).toThrow(
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

  it("accepts only configured maxExpandedEntries values", () => {
    for (const value of ["-1", "10", "20", "50", "100"]) {
      saveConfig("maxExpandedEntries", value);
      expect(getConfig().maxExpandedEntries).toBe(Number(value));
    }

    for (const value of ["0", "25", "99"]) {
      expect(() => saveConfig("maxExpandedEntries", value)).toThrow(
        "Invalid config update",
      );
    }

    saveConfig("maxExpandedEntries", "20");
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

  it("validates bashCollapsedDisplay against allowed values", () => {
    expect(getConfig().bashCollapsedDisplay).toBe("preview");

    saveConfig("bashCollapsedDisplay", "summary");
    expect(getConfig().bashCollapsedDisplay).toBe("summary");
    expect(() => saveConfig("bashCollapsedDisplay", "tail")).toThrow(
      "Invalid config update",
    );

    writeFileSync(
      process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH!,
      JSON.stringify({ bashCollapsedDisplay: "tail" }),
    );
    loadConfig();
    expect(getConfig().bashCollapsedDisplay).toBe("preview");
  });
});

describe("config storage failures", () => {
  it("falls back to defaults when the config directory cannot be prepared", () => {
    saveConfig("asciiHeaderAlign", "right");
    const failure = new Error("prepare failed");
    const errors: unknown[] = [];

    loadConfig(
      (error) => errors.push(error),
      createStorage({
        prepare() {
          throw failure;
        },
      }),
    );

    expect(getConfig().asciiHeaderAlign).toBe(
      getDefaultConfig().asciiHeaderAlign,
    );
    expect(errors).toEqual([failure]);
  });

  it("reports a failure to create a missing config file", () => {
    const failure = new Error("create failed");
    const errors: unknown[] = [];

    loadConfig(
      (error) => errors.push(error),
      createStorage({
        exists: () => false,
        write() {
          throw failure;
        },
      }),
    );

    expect(getConfig().asciiHeaderAlign).toBe(
      getDefaultConfig().asciiHeaderAlign,
    );
    expect(errors).toEqual([failure]);
  });

  it("falls back to defaults when the config cannot be read", () => {
    saveConfig("asciiHeaderAlign", "right");
    const failure = new Error("read failed");
    const errors: unknown[] = [];

    loadConfig(
      (error) => errors.push(error),
      createStorage({
        read() {
          throw failure;
        },
      }),
    );

    expect(getConfig().asciiHeaderAlign).toBe(
      getDefaultConfig().asciiHeaderAlign,
    );
    expect(errors).toEqual([failure]);
  });

  it("falls back to defaults when the config contains malformed JSON", () => {
    const errors: unknown[] = [];

    loadConfig(
      (error) => errors.push(error),
      createStorage({ read: () => "{" }),
    );

    expect(getConfig().asciiHeaderAlign).toBe(
      getDefaultConfig().asciiHeaderAlign,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(SyntaxError);
  });

  it("keeps validated config when normalization cannot be persisted", () => {
    const failure = new Error("normalize failed");
    const errors: unknown[] = [];

    loadConfig(
      (error) => errors.push(error),
      createStorage({
        read: () => JSON.stringify({ asciiHeaderAlign: "right" }),
        write() {
          throw failure;
        },
      }),
    );

    expect(getConfig().asciiHeaderAlign).toBe("right");
    expect(errors).toEqual([failure]);
  });

  it("does not mutate config or notify listeners when a save fails", () => {
    saveConfig("asciiHeaderAlign", "right");
    const failure = new Error("save failed");
    let notificationCount = 0;
    setOnConfigChange(() => notificationCount++);

    expect(() =>
      saveConfig(
        "asciiHeaderAlign",
        "center",
        createStorage({
          write() {
            throw failure;
          },
        }),
      ),
    ).toThrow(failure);

    expect(getConfig().asciiHeaderAlign).toBe("right");
    expect(notificationCount).toBe(0);
  });
});
