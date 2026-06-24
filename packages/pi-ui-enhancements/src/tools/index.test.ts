import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig } from "../config";
import { patchTools } from ".";

let configDir: string;
let previousConfigPath: string | undefined;

function mkPi() {
  const registered: string[] = [];
  const pi = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => {
      registered.push(tool.name);
    },
  } as unknown as ExtensionAPI;

  return { pi, registered };
}

beforeEach(() => {
  previousConfigPath = process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  configDir = mkdtempSync(join(tmpdir(), "pi-ui-enhancements-tools-"));
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

describe("patchTools", () => {
  it("registers only essential built-in patches by default", () => {
    const { pi, registered } = mkPi();

    patchTools(pi);

    expect(registered).toEqual(["read", "write", "edit", "bash"]);
  });

  it("registers all built-in patches when configured", () => {
    saveConfig("patchedBuiltInTools", "all");
    const { pi, registered } = mkPi();

    patchTools(pi);

    expect(registered).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      "ls",
      "find",
      "grep",
    ]);
  });
});
