# pi-searxng-suite

SearxNG-powered web search and extraction tools for [pi](https://pi.dev).

## Overview

This extension provides two LLM-callable tools:

- **`web_search`:** Search the web via your SearxNG instance with configurable result limits, timeouts, and SafeSearch.
- **`web_extract`:** Extract content from any URL, supporting multiple formats:

| Format     | Output                                                                              |
| ---------- | ----------------------------------------------------------------------------------- |
| HTML       | Denoised, converted to Markdown with metadata (title, author, date, description)    |
| Plain text | Raw text with source info                                                           |
| PDF        | Text extracted per page with headers and separators (text-native PDFs only, no OCR) |
| Images     | Attached with metadata (format, size)                                               |

## Requirements

- **Node.js 20+** (extensions run via jiti)
- A running [SearxNG](https://searxng.org) instance (local or remote)

## Installation

```bash
pi install npm:pi-searxng-suite
```

Or install locally for development:

```bash
git clone https://github.com/blazer2k/pi-searxng-suite.git
cd pi-searxng-suite
bun install
pi -e ./index.ts
```

## Configuration

### Environment Variables

| Variable          | Default                 | Description                              |
| ----------------- | ----------------------- | ---------------------------------------- |
| `SEARXNG_URL`     | `http://localhost:8888` | Base URL of your SearxNG instance        |
| `SEARXNG_API_KEY` | _(none)_                | Bearer token for authenticated instances |

These must be available to the process running pi – set them in your shell profile, systemd service, or however you launch pi.

### Runtime Settings

Run `/search-config` in pi to adjust settings at runtime:

| Setting            | Options                           | Description                                                            |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------- |
| Results limit      | 1, 5, 10, 15, 20                  | Maximum results per search                                             |
| Timeout            | 5s, 10s, 15s, 30s                 | Request timeout                                                        |
| SafeSearch         | 0 (off), 1 (moderate), 2 (strict) | Filter explicit content                                                |
| Allow private URLs | false, true                       | Allow requests to localhost and private IP ranges (`web_extract` only) |
| Verbose            | false, true                       | Show full results instead of compact summary                           |

Settings persist to `~/.pi/agent/pi-searxng-suite.json`.

## Security

- Private IP ranges (localhost, 10.x, 127.x, 192.168.x, 172.16–31.x) are blocked by default for `web_extract`.
- Content size limits prevent oversized downloads (2 MB HTML, 1 MB text, 50 MB PDF/images).
- All search and extract results are flagged as untrusted content in the LLM context.

## License

MIT – see [LICENSE](LICENSE)
