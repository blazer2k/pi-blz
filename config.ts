import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";

const configPath = join(homedir(), ".pi", "agent", "search.json");

export interface Config {
  timeoutMs: number;
  limit: number;
  safesearch: 0 | 1 | 2;
}

const defaultConfig: Config = {
  timeoutMs: 15000,
  limit: 10,
  safesearch: 0,
};

const ConfigSchema = Type.Object({
  timeoutMs: Type.Number(),
  limit: Type.Number(),
  safesearch: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
});

const configValidator = TypeCompiler.Compile(ConfigSchema);

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
