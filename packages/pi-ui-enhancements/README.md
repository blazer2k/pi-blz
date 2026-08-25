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

| Setting                | Description                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| Enable ASCII header    | Show ASCII art header at session start                                     |
| Header font            | Font for ASCII art header (19 figlet fonts + 2 bundled, default: Greek)    |
| Header color           | Theme color of ASCII header (text, accent, dim)                            |
| Header alignment       | Horizontal alignment (left, center, right)                                 |
| Show version           | Display pi version below ASCII header                                      |
| Show interrupt hint    | Show "esc to interrupt" next to the working indicator                      |
| Show run duration      | Show elapsed time while working, toast on completion                       |
| Patched built-in tools | Which built-in tool renderers to replace (essential or all)                |
| Patch custom tools     | Apply compact rendering to third-party tools                               |
| Capitalize tool names  | Capitalize custom tool call labels (default: true, e.g. search → Search)   |
| Max call width         | Maximum width for tool call and output lines                               |
| Max expanded entries   | Maximum entries shown by capped list and custom results (-1 for unlimited) |
| Collapsed Bash output  | Show a five-row output preview or summary only (default: preview)          |
| Editor border color    | How the editor border is colored (thinking, dim, muted)                    |
| Show thinking level    | Display thinking level in editor footer                                    |
| Show cache tokens      | Display cache read/write token counts                                      |
| Show cost              | Display total session cost in editor footer                                |
| Show git branch        | Display current git branch in editor header                                |

### Built-in Tool Patches

The `patchedBuiltInTools` setting has two modes:

- **essential** (default): read, write, edit, bash
- **all**: adds ls, find, grep

Changes here require `/reload` since tool renderers are registered at load time. Everything else applies immediately.

Expanded Write and Bash calls show their complete output. Expanded list tools show a head/tail split capped by `maxExpandedEntries`, with an omission marker between the two sections. Generic custom-tool output retains its existing capped rendering.

`bashCollapsedDisplay` controls collapsed Bash results. `preview` shows all output up to five rows, or two head lines, an omission marker, and two tail lines for longer output. `summary` hides output and reports its line count in the footer.

### Editor and Footer Ownership

Pi supports one custom editor and one custom footer at a time; extensions do not compose these components automatically. This extension installs a `CustomEditor` subclass for each TUI session and uses the footer only for extension-provided status messages already not shown in the editor border.

The editor factory active during registration is restored on shutdown only when the rounded editor is still active. An editor installed later by another extension is therefore not overwritten during disposal. Changing UI settings re-registers the rounded editor, so extension load order and later settings changes determine which custom editor is active.

When another footer replaces this extension's footer, Pi disposes the previous footer component and releases its ownership. The extension only clears the footer during shutdown while its own component still owns that slot.

### Third-Party Tool Monkey-Patching

By default, the extension monkey-patches `ExtensionRunner.prototype.getAllRegisteredTools` to intercept third-party tool definitions and wrap their output in the same compact format. Built-in tools and tools with `renderShell: "self"` are left alone.

The compatibility layer tracks each extension instance independently and restores Pi's original method only while it still owns the prototype slot. Unexpected registry shapes leave Pi's values unchanged, renderer failures use generic output, and each compatibility problem is reported once instead of interrupting tool execution. A prototype patch installed later by another extension is never overwritten during cleanup.

Custom tool call labels are capitalized by default while preserving the tool's own `renderCall()` layout when possible. For example, `mcp` becomes `Mcp`.

If you prefer third-party tools to render natively, disable `patchCustomTools` in the settings menu. If you prefer lowercase custom tool labels, disable `capitalizeToolNames`.

## Persistence

Settings are saved to `~/.pi/agent/ui-settings.json` and restored on each session. Override the path with `PI_UI_ENHANCEMENTS_CONFIG_PATH`.

## License

MIT
