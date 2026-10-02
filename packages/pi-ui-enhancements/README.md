# @blazer2k/pi-ui-enhancements

Visual polish and compact tool rendering for [pi](https://pi.dev).

**Current version:** 0.1.0

## Overview

This extension adds visual improvements to pi's TUI:

- Configurable ASCII art header at session start, rendered via figlet or the bundled Greek pi fonts.
- Rounded border around the editor showing cwd, git branch, model, token usage, and context percentage.
- Shimmer animation on the "Working" label with elapsed duration and an interrupt hint.
- Compact tree-drawing summaries for tool output instead of verbose raw output. Paths are hyperlinked when your terminal supports it. Third-party tools get wrapped too (see below).
- Optional capitalization for custom tool call labels, enabled by default.

![Example: compact tool output with ASCII header](images/example.webp)

![Example: rounded editor border with working indicator](images/editor.webp)

## Installation

```bash
pi install npm:@blazer2k/pi-ui-enhancements
```

Or install locally for development:

```bash
git clone https://github.com/blazer2k/pi-blz.git
cd pi-blz
npm install
pi -e ./packages/pi-ui-enhancements/src/index.ts
```

## Configuration

Run `/ui-settings` in pi to open the settings menu. The list is searchable: type to filter settings.

### Available Settings

| Setting               | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| Enable ASCII header   | Show ASCII art header at session start                                     |
| Header font           | Font for ASCII art header (19 figlet fonts + 2 bundled, default: Greek)    |
| Header color          | Theme color of ASCII header (text, accent, dim)                            |
| Header alignment      | Horizontal alignment (left, center, right)                                 |
| Show version          | Display pi version below ASCII header                                      |
| Show interrupt hint   | Show "esc to interrupt" next to the working indicator                      |
| Show run duration     | Show elapsed time while working, toast on completion                       |
| Patch custom tools    | Apply compact rendering to extension tools, including Codemode             |
| Capitalize tool names | Capitalize custom tool call labels (default: true, e.g. search → Search)   |
| Indicator style       | Symbol style of tool-call status indicators (dot, circle, diamond)         |
| Indicator color       | Color of filled and completed indicators (success, text, toolTitle)        |
| Max expanded entries  | Maximum entries shown by capped list and custom results (-1 for unlimited) |
| Collapsed output      | Bash and Codemode: preview or summary output (default: preview)            |
| Editor frame color    | Color of editor borders and embedded status text (thinking, dim, muted)    |
| Show thinking level   | Display thinking level in editor footer                                    |
| Show cache tokens     | Display cache read/write token counts                                      |
| Show cost             | Display total session cost in editor footer                                |
| Show git branch       | Display current git branch in editor header                                |

### Built-in Tool Patches

The extension replaces the renderers for read, write, edit, bash, ls, find, and grep without enabling those tools. Pi's `defaultTools` setting and CLI options control which tools are active. A fresh Pi configuration uses our renderers for read, bash, edit, and write; ls, find, and grep use our renderers when enabled.

UI settings apply immediately. Tool calls and output adapt to the available terminal width, including after resizing.

Expanded Write and Bash calls show their complete output. Expanded list tools show a head/tail split capped by `maxExpandedEntries`, with an omission marker between the two sections. Generic custom-tool output retains its existing capped rendering.

`collapsedOutputDisplay` controls collapsed Bash and wrapped Codemode results. Codemode follows this setting only while `patchCustomTools` is enabled. `preview` shows up to three logical output lines, or the first line, an omission marker, and the last line for longer output. Long lines are shortened to fit the available width. `summary` hides ordinary output and reports its line count in the footer. Failed Codemode scripts still show a short diagnostic.

### Codemode Rendering

When `patchCustomTools` is enabled, collapsed Codemode shows a highlighted script preview and summarizes nested calls by count. Bottom metadata includes running/failed/cancelled counts when present, duration, available model-call costs, and expansion hints. Live duration starts when execution is observed; Pi's reported wall time supplies the final duration when available. Historical results without timing data do not get an invented duration.

Expanded Codemode retains native script rendering, nested-call details, and all returned output, followed by our metadata footer. Native costs remain visible, so costs can appear in both native details and our footer. `maxExpandedEntries` does not cap Codemode. Full-output links and failed-spill warnings remain visible in both collapsed modes; expansion does not read spilled files or recover content omitted by Pi. Image display remains Pi-owned.

### Editor and Footer Ownership

Pi supports one custom editor and one custom footer at a time; extensions do not compose these components automatically. This extension installs a `CustomEditor` subclass for each TUI session and uses the footer only for extension-provided status messages already not shown in the editor border.

The editor factory active during registration is restored on shutdown only when the rounded editor is still active. An editor installed later by another extension is therefore not overwritten during disposal. Changing UI settings re-registers the rounded editor, so extension load order and later settings changes determine which custom editor is active.

When another footer replaces this extension's footer, Pi disposes the previous footer component and releases its ownership. The extension only clears the footer during shutdown while its own component still owns that slot.

### Extension Tool Monkey-Patching

By default, the extension monkey-patches `ExtensionRunner.prototype.getAllRegisteredTools` to wrap eligible extension-tool definitions. Native Codemode gets specialized rendering through this same hook, identified by Pi's built-in source metadata. Third-party replacements named `codemode` keep ordinary custom-tool behavior. Core tools with our own renderers and tools with `renderShell: "self"` are left alone.

Pi still loads and registers its own Codemode extension. We do not replace its registration, so no Codemode replacement warning or built-in configuration change is needed.

The compatibility layer tracks each extension instance independently and restores Pi's original method only while it still owns the prototype slot. Unexpected registry shapes leave Pi's values unchanged, renderer failures use generic output, and each compatibility problem is reported once instead of interrupting tool execution. A prototype patch installed later by another extension is never overwritten during cleanup.

Custom tool call labels are capitalized by default while preserving the tool's own `renderCall()` layout when possible. For example, `mcp` becomes `Mcp`.

Disable `patchCustomTools` to use native rendering for extension tools, including Codemode. Core Read/Bash/etc. enhancements remain independent of that switch. If you prefer lowercase wrapped tool labels, including Codemode, disable `capitalizeToolNames`.

## Persistence

Settings are saved to `~/.pi/agent/ui-settings.json` and restored on each session. Override the path with `PI_UI_ENHANCEMENTS_CONFIG_PATH`.

## License

MIT
