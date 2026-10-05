import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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

describe("config validation", () => {
  it("defaults to the compact left-aligned header", () => {
    expect(getDefaultConfig()).toMatchObject({
      headerMode: "compact",
      headerAlign: "left",
    });
    expect(getConfig()).toEqual(getDefaultConfig());
  });

  it("recovers invalid settings individually and normalizes the file", () => {
    let normalized = "";
    loadConfig(
      undefined,
      createStorage({
        read: () =>
          JSON.stringify({
            headerMode: "unsupported",
            headerAlign: "center",
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
      headerAlign: "center",
      roundedEditorShowCost: true,
    });
    expect(JSON.parse(normalized)).toEqual(getConfig());
  });

  it("loads boolean and enum settings as JSON values", () => {
    writeFileSync(
      process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH!,
      JSON.stringify({
        roundedEditorShowBranch: false,
        roundedEditorShowCost: true,
        headerAlign: "center",
      }),
    );
    loadConfig();
    expect(getConfig()).toEqual({
      ...getDefaultConfig(),
      roundedEditorShowBranch: false,
      roundedEditorShowCost: true,
      headerAlign: "center",
    });
  });

  it("accepts all four header modes and both alignments", () => {
    for (const headerMode of ["native", "compact", "large", "off"] as const) {
      for (const headerAlign of ["left", "center"] as const) {
        loadConfig(
          undefined,
          createStorage({
            read: () => JSON.stringify({ headerMode, headerAlign }),
          }),
        );
        expect(getConfig()).toEqual({
          ...getDefaultConfig(),
          headerMode,
          headerAlign,
        });
      }
    }
  });

  it("recovers invalid primitive and enum values", () => {
    loadConfig(
      undefined,
      createStorage({
        read: () =>
          JSON.stringify({
            roundedEditorShowBranch: "false",
            roundedEditorShowCost: 1,
            headerMode: false,
            headerAlign: "right",
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
      JSON.stringify({ maxExpandedEntries: 10.5 }),
    );
    loadConfig();
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
    setTestConfig({ headerAlign: "center" });
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
    expect(getConfig().headerAlign).toBe(getDefaultConfig().headerAlign);
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
    expect(getConfig().headerAlign).toBe(getDefaultConfig().headerAlign);
    expect(errors).toEqual([failure]);
  });

  it("falls back to defaults when the config cannot be read", () => {
    setTestConfig({ headerAlign: "center" });
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
    expect(getConfig().headerAlign).toBe(getDefaultConfig().headerAlign);
    expect(errors).toEqual([failure]);
  });

  it("falls back to defaults when the config contains malformed JSON", () => {
    const errors: unknown[] = [];
    loadConfig(
      (error) => errors.push(error),
      createStorage({ read: () => "{" }),
    );
    expect(getConfig().headerAlign).toBe(getDefaultConfig().headerAlign);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(SyntaxError);
  });

  it("keeps validated config when normalization cannot be persisted", () => {
    const failure = new Error("normalize failed");
    const errors: unknown[] = [];
    loadConfig(
      (error) => errors.push(error),
      createStorage({
        read: () => JSON.stringify({ headerAlign: "center" }),
        write() {
          throw failure;
        },
      }),
    );
    expect(getConfig().headerAlign).toBe("center");
    expect(errors).toEqual([failure]);
  });
});
