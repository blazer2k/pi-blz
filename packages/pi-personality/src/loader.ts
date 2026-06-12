import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BUILTIN_DIR = join(__dirname, "..", "builtin");
const CUSTOM_DIR = join(homedir(), ".pi", "agent", "personalities");
const CONFIG_PATH = join(homedir(), ".pi", "agent", "personality-state.json");

const CONFIG_VERSION = 1;
const defaultState = {
  version: CONFIG_VERSION,
  activePersonality: "pragmatic",
};

const FRONTMATTER_RE =
  /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

export interface Personality {
  name: string;
  description: string;
  prompt: string;
}

function parseFrontmatter(text: string): {
  data: Record<string, string>;
  content: string;
} {
  const match = text.match(FRONTMATTER_RE);
  if (!match || !match[1]) throw new Error("No frontmatter found");

  const data: Record<string, string> = {};
  for (const line of match[1]?.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) data[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  return { data, content: match[2] ?? "" };
}

function loadFromDir(dir: string): Map<string, Personality> {
  const map = new Map<string, Personality>();
  if (!existsSync(dir)) return map;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    try {
      const { data, content } = parseFrontmatter(
        readFileSync(join(dir, file), "utf-8"),
      );
      const name = data.name;
      if (!name) {
        console.warn(
          `[personality] Skipping ${file}: missing "name" in frontmatter`,
        );
        continue;
      }
      map.set(name.toLowerCase(), {
        name,
        description: data.description ?? "",
        prompt: content.trimStart(),
      });
    } catch (err) {
      console.warn(
        `[personality] Failed to load ${file}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  return map;
}

export function loadPersonalities(): Map<string, Personality> {
  const map = loadFromDir(BUILTIN_DIR);

  // Custom personalities with the same name override builtin, others are added alongside
  for (const entry of loadFromDir(CUSTOM_DIR)) map.set(entry[0], entry[1]);
  return map;
}

export function loadActive(): string {
  try {
    if (!existsSync(CONFIG_PATH)) {
      mkdirSync(dirname(CONFIG_PATH), { recursive: true });
      writeFileSync(CONFIG_PATH, JSON.stringify(defaultState, null, 2));
      return defaultState.activePersonality;
    }
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (typeof raw?.activePersonality === "string") {
      const merged = { ...defaultState, ...raw };
      const serialized = JSON.stringify(merged, null, 2);
      const existing = readFileSync(CONFIG_PATH, "utf-8");
      if (existing !== serialized) {
        writeFileSync(CONFIG_PATH, serialized);
      }
      return merged.activePersonality;
    }
    console.warn(
      `[personality] Invalid config at ${CONFIG_PATH}: missing activePersonality`,
    );
  } catch (err) {
    console.warn(
      `[personality] Failed to read config at ${CONFIG_PATH}: ${err instanceof Error ? err.message : err}`,
    );
  }

  return defaultState.activePersonality;
}

export function saveActive(personalityKey: string): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  const state = { ...defaultState, activePersonality: personalityKey };
  const serialized = JSON.stringify(state, null, 2);
  try {
    const existing = readFileSync(CONFIG_PATH, "utf-8");
    if (existing === serialized) return;
  } catch {}
  writeFileSync(CONFIG_PATH, serialized);
}
