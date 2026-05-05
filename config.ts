import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

const configPath = join(homedir(), ".pi", "agent", "search.json");

export interface Config {
  limit: number;
  timeoutMs: number;
  safesearch: 0 | 1 | 2;
  verbose: boolean;
}

const defaultConfig: Config = {
  limit: 10,
  timeoutMs: 15000,
  safesearch: 0,
  verbose: true,
};

const ConfigSchema = Type.Object(
  {
    limit: Type.Number({ minimum: 1, maximum: 50 }),
    timeoutMs: Type.Number({ minimum: 1000, maximum: 120000 }),
    safesearch: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
    verbose: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type ConfigKey = keyof Config;

let config: Config = { ...defaultConfig };
const configValidator = Compile(ConfigSchema);

function validateConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null) return defaultConfig;

  const merged = { ...defaultConfig, ...raw };
  if (!configValidator.Check(merged)) {
    return { ...defaultConfig };
  }

  return merged as Config;
}

export function loadConfig(): void {
  try {
    if (existsSync(configPath)) {
      const saved = JSON.parse(readFileSync(configPath, "utf-8"));
      const validated = validateConfig(saved);
      config = validated;
    }

    if (!existsSync(configPath)) {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    }
  } catch (error) {
    console.error(`Failed to load config from ${configPath}:`, error);
  }
}

function parseConfigValue(id: ConfigKey, value: string): Config[ConfigKey] {
  switch (id) {
    case "limit":
      return Number(value);
    case "timeoutMs":
      return Number(value);
    case "safesearch":
      const num = Number(value);
      if (num !== 0 && num !== 1 && num !== 2) {
        throw new Error(`Invalid safesearch value: ${value}`);
      }
      return num;
    case "verbose":
      return value === "true";
  }
}

export function saveConfig(id: ConfigKey, value: string): void {
  try {
    let parsed = parseConfigValue(id, value);

    const updated = { ...config, [id]: parsed };
    if (!configValidator.Check(updated)) {
      throw new Error(`Invalid config update: ${id}=${value}`);
    }
    config = updated as Config;
    writeFileSync(configPath, JSON.stringify(updated, null, 2));
  } catch (err) {
    console.error("Failed to save config:", err);
  }
}

export function getConfig(): Config {
  return config;
}
