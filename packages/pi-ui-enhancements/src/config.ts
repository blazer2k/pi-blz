import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  applyConfigUpdate,
  getDefaultConfig,
  validateConfig,
  type Config,
  type ConfigKey,
} from "./config/definition";

export {
  ALLOWED_FONTS,
  type Config,
  type ConfigKey,
} from "./config/definition";

function getConfigPath(): string {
  if (process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH) {
    return process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  }
  if (process.env.NODE_ENV === "test") {
    return join(tmpdir(), "pi-ui-enhancements-test", "ui-settings.json");
  }
  return join(getAgentDir(), "ui-settings.json");
}

function reportConfigError(
  onError: ((error: unknown) => void) | undefined,
  message: string,
  error: unknown,
): void {
  if (onError) onError(error);
  else console.error(message, error);
}

let onConfigChange: (() => void) | null = null;
let config = getDefaultConfig();

export function setOnConfigChange(callback: (() => void) | null): void {
  onConfigChange = callback;
}

export function clearOnConfigChange(): void {
  onConfigChange = null;
}

export function loadConfig(onError?: (error: unknown) => void): void {
  const configPath = getConfigPath();

  try {
    mkdirSync(dirname(configPath), { recursive: true });
  } catch (error) {
    config = getDefaultConfig();
    reportConfigError(
      onError,
      `Failed to prepare config directory for ${configPath}:`,
      error,
    );
    return;
  }

  if (!existsSync(configPath)) {
    config = getDefaultConfig();
    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2));
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
    const saved: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
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
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    reportConfigError(
      onError,
      `Failed to normalize config at ${configPath}:`,
      error,
    );
  }
}

export function saveConfig(key: ConfigKey, value: string): void {
  const updated = applyConfigUpdate(config, key, value);
  const configPath = getConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(updated, null, 2));
  config = updated;
  onConfigChange?.();
}

export function getConfig(): Config {
  return { ...config };
}
