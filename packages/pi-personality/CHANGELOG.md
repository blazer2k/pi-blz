# Changelog

## [0.1.0] – 2026-06-12

### Added

- **`/personality` command** – TUI selector to switch communication styles at runtime
- **Three builtin personalities** – Pragmatic (from Codex CLI), Friendly (from Codex CLI), Teacher (custom)
- **Custom personality support** – Drop `.md` files with YAML frontmatter into `~/.pi/agent/personalities/`
- **Persistence** – Active personality saved to `~/.pi/agent/personality-state.json` and restored on next session
