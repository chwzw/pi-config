# pi-config

My [pi coding agent](https://github.com/badlogic/pi-mono) config. Repo root is `~/.pi/agent` itself.

## New machine setup

```bash
git clone git@github.com:chwzw/pi-config.git /tmp/pi-config \
  && bash /tmp/pi-config/setup.sh
```

Clones to `~/.pi/agent` (backs up any existing dir, restores `auth.json`/`trust.json`/`sessions/`), installs extension deps. Re-run to pull latest.

## Layout

- `extensions/` — custom TypeScript extensions: `ask-user-question`, `cd`, `caveman-auto`, `btw`, `context-bar-footer`, `last-question`, `herdr-agent-state`, etc.
- `skills/` — installed skills (including third-party syncs under `github.com/` and `npm/`)
- `learn/` — learning examples: agents, extensions, skills (mermaid/visualization tools, etc.)
- `patches/` — local patches for third-party packages
- `bin/` — local tools (`fd`)
- `settings.json` / `keybindings.json` / `AGENTS.md` — main config

## Notes

- Runtime state (`sessions/`, `auth.json`, `trust.json`, ...) is not tracked (see `.gitignore`)
- Most files under `skills/` come from upstream syncs; local changes go through `patches/` when possible
