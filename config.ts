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
}

const defaultConfig: Config = {
  limit: 10,
  timeoutMs: 15000,
  safesearch: 0,
};

const ConfigSchema = Type.Object({
  limit: Type.Number(),
  timeoutMs: Type.Number(),
  safesearch: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
});

const configValidator = Compile(ConfigSchema);

function validateConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null) return defaultConfig;

  return configValidator.Check(raw) ? (raw as Config) : defaultConfig;
}

export function loadConfig(): Config {
  try {
    if (existsSync(configPath)) {
      const saved = JSON.parse(readFileSync(configPath, "utf-8"));
      return validateConfig(saved);
    }

    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  } catch (error) {
    console.error(`Failed to load config from ${configPath}:`, error);
    return defaultConfig;
  }
}

export function saveConfig(id: string, value: string): void {
  try {
    const current = loadConfig();
    let parsed: unknown = value;

    if (id === "safesearch") {
      const num = Number(parsed);
      if ([0, 1, 2].includes(num)) parsed = num as 0 | 1 | 2;
    } else {
      parsed = Number(value);
    }

    const updated = { ...current, [id]: parsed };
    if (configValidator.Check(updated)) {
      writeFileSync(configPath, JSON.stringify(updated, null, 2));
    }
  } catch (err) {
    console.error("Failed to save config:", err);
  }
}
