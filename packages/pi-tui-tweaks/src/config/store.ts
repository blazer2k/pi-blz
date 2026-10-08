import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getDefaultConfig, validateConfig, type Config } from "./definition";

export interface ConfigStorage {
  prepare(configPath: string): void;
  exists(configPath: string): boolean;
  read(configPath: string): string;
  write(configPath: string, contents: string): void;
}

const nodeConfigStorage: ConfigStorage = {
  prepare(configPath) {
    mkdirSync(dirname(configPath), { recursive: true });
  },
  exists: existsSync,
  read(configPath) {
    return readFileSync(configPath, "utf-8");
  },
  write(configPath, contents) {
    writeFileSync(configPath, contents);
  },
};

function getConfigPath(): string {
  if (process.env.PI_TUI_TWEAKS_CONFIG_PATH) {
    return process.env.PI_TUI_TWEAKS_CONFIG_PATH;
  }
  if (process.env.NODE_ENV === "test") {
    return join(tmpdir(), "pi-tui-tweaks-test", "pi-tui-tweaks.json");
  }
  return join(getAgentDir(), "pi-tui-tweaks.json");
}

function reportConfigError(
  onError: ((error: unknown) => void) | undefined,
  message: string,
  error: unknown,
): void {
  if (onError) onError(error);
  else console.error(message, error);
}

let config = getDefaultConfig();

export function loadConfig(
  onError?: (error: unknown) => void,
  storage: ConfigStorage = nodeConfigStorage,
): void {
  const configPath = getConfigPath();

  try {
    storage.prepare(configPath);
  } catch (error) {
    config = getDefaultConfig();
    reportConfigError(
      onError,
      `Failed to prepare config directory for ${configPath}:`,
      error,
    );
    return;
  }

  if (!storage.exists(configPath)) {
    config = getDefaultConfig();
    try {
      storage.write(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      reportConfigError(
        onError,
        `Failed to create config at ${configPath}:`,
        error,
      );
    }
    return;
  }

  try {
    const saved: unknown = JSON.parse(storage.read(configPath));
    config = validateConfig(saved);
  } catch (error) {
    config = getDefaultConfig();
    reportConfigError(
      onError,
      `Failed to load config from ${configPath}:`,
      error,
    );
    return;
  }

  try {
    // Persist missing defaults and discard unknown or invalid values.
    storage.write(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    reportConfigError(
      onError,
      `Failed to normalize config at ${configPath}:`,
      error,
    );
  }
}

export function getConfig(): Config {
  return structuredClone(config);
}
