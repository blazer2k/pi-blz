import { type SettingItem } from "@mariozechner/pi-tui";
import { type Config } from "../helpers/config";

export function getSettingsList(config: Config): SettingItem[] {
  return [
    {
      id: "limit",
      label: "Results limit",
      description: "Max results from search engines",
      currentValue: String(config.limit),
      values: ["1", "5", "10", "15", "20"],
    },
    {
      id: "timeoutMs",
      label: "Timeout",
      description: "Request timeout in milliseconds",
      currentValue: String(config.timeoutMs),
      values: ["5000", "10000", "15000", "30000"],
    },
    {
      id: "safesearch",
      label: "SafeSearch",
      description:
        "Filter explicit content (0 = off, 1 = moderate, 2 = strict)",
      currentValue: String(config.safesearch),
      values: ["0", "1", "2"],
    },
    {
      id: "allowPrivateUrls",
      label: "Allow private URLs",
      description: "Allow requests to local and private IP ranges",
      currentValue: String(config.allowPrivateUrls),
      values: ["false", "true"],
    },
    {
      id: "verbose",
      label: "Verbose",
      description: "Render results in tool output",
      currentValue: String(config.verbose),
      values: ["false", "true"],
    },
  ] satisfies SettingItem[];
}
