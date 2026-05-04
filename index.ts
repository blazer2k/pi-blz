import { loadConfig } from "./config";
import { search } from "./search";

const config = loadConfig();

console.log(
  await search(
    "Hello World",
    config.limit,
    config.timeoutMs,
    config.safesearch,
  ),
);
