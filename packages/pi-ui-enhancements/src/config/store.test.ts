import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { getDefaultConfig } from "./definition";
import { setTestConfig } from "../testing/helpers";
import { getConfig, loadConfig, type ConfigStorage } from "./store";

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
  if (previousConfigPath === undefined) {
    delete process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  } else {
    process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = previousConfigPath;
  }
  rmSync(configDir, { recursive: true, force: true });
  loadConfig();
});

describe("config compatibility", () => {
  it("ignores removed and additional fields without resetting valid settings", () => {
    const errors: unknown[] = [];
    let normalized = "";

    loadConfig(
      (error) => errors.push(error),
      createStorage({
        read: () =>
          JSON.stringify({
            patchedBuiltInTools: "all",
            bashCollapsedDisplay: "summary",
            futureSetting: true,
            maxCallWidth: 120,
            indicatorColor: "text",
          }),
        write(_path, contents) {
          normalized = contents;
        },
      }),
    );

    expect(errors).toEqual([]);
    expect(getConfig()).toEqual({
      ...getDefaultConfig(),
      indicatorColor: "text",
    });
    expect(JSON.parse(normalized)).toEqual(getConfig());
  });
});

describe("config validation", () => {
  it("recovers invalid settings individually and normalizes the file", () => {
    const report = spyOn(console, "error").mockImplementation(() => {});
    let normalized = "";
    try {
      loadConfig(
        undefined,
        createStorage({
          read: () =>
            JSON.stringify({
              asciiHeaderEnabled: "false",
              asciiHeaderFont: "not-a-font",
              asciiHeaderAlign: "right",
              maxExpandedEntries: 25,
              roundedEditorShowCost: true,
            }),
          write(_path, contents) {
            normalized = contents;
          },
        }),
      );

      expect(getConfig()).toEqual({
        ...getDefaultConfig(),
        asciiHeaderAlign: "right",
        roundedEditorShowCost: true,
      });
      expect(JSON.parse(normalized)).toEqual(getConfig());
      expect(report).toHaveBeenCalledWith(
        `Invalid font "not-a-font", falling back to "${getDefaultConfig().asciiHeaderFont}"`,
      );
    } finally {
      report.mockRestore();
    }
  });

  it("loads boolean and enum settings as JSON values", () => {
    writeFileSync(
      process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH!,
      JSON.stringify({
        asciiHeaderEnabled: false,
        roundedEditorShowCost: true,
        asciiHeaderAlign: "right",
      }),
    );
    loadConfig();
    expect(getConfig()).toEqual({
      ...getDefaultConfig(),
      asciiHeaderEnabled: false,
      roundedEditorShowCost: true,
      asciiHeaderAlign: "right",
    });
  });

  it("recovers invalid primitive and enum values", () => {
    loadConfig(
      undefined,
      createStorage({
        read: () =>
          JSON.stringify({
            asciiHeaderEnabled: "false",
            roundedEditorShowCost: 1,
            asciiHeaderAlign: "justify",
            indicatorStyle: null,
          }),
      }),
    );
    expect(getConfig()).toEqual(getDefaultConfig());
  });
});

describe("config numeric values", () => {
  it("accepts only configured maxExpandedEntries values", () => {
    for (const value of [-1, 10, 20, 50, 100] as const) {
      loadConfig(
        undefined,
        createStorage({
          read: () => JSON.stringify({ maxExpandedEntries: value }),
        }),
      );
      expect(getConfig().maxExpandedEntries).toBe(value);
    }

    for (const value of [0, 25, 99, 20.5, null, "20", "NaN", "Infinity"]) {
      loadConfig(
        undefined,
        createStorage({
          read: () => JSON.stringify({ maxExpandedEntries: value }),
        }),
      );
      expect(getConfig().maxExpandedEntries).toBe(
        getDefaultConfig().maxExpandedEntries,
      );
    }
  });

  it("falls back to defaults for fractional numeric values loaded from disk", () => {
    writeFileSync(
      process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH!,
      JSON.stringify({ maxCallWidth: 120.5, maxExpandedEntries: 10.5 }),
    );
    loadConfig();
    expect(getConfig()).not.toHaveProperty("maxCallWidth");
    expect(getConfig().maxExpandedEntries).toBe(20);
  });

  it("validates collapsedOutputDisplay against allowed values", () => {
    expect(getConfig().collapsedOutputDisplay).toBe("preview");
    writeFileSync(
      process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH!,
      JSON.stringify({ collapsedOutputDisplay: "summary" }),
    );
    loadConfig();
    expect(getConfig().collapsedOutputDisplay).toBe("summary");

    writeFileSync(
      process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH!,
      JSON.stringify({ collapsedOutputDisplay: "tail" }),
    );
    loadConfig();
    expect(getConfig().collapsedOutputDisplay).toBe("preview");
  });
});

describe("config storage failures", () => {
  it("falls back to defaults when the config directory cannot be prepared", () => {
    setTestConfig({ asciiHeaderAlign: "right" });
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
    setTestConfig({ asciiHeaderAlign: "right" });
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
});
