# pi-agent startup performance fix

## Diagnosis

Measured: `pi --help` takes **2.5-3.3s** on a warm jiti cache, **15-20s** on cold.

The slow part is user extension loading via **jiti** (TypeScript runtime).
Every `npm:pi-*` and git-installed extension is `.ts` files transformed at
startup by jiti using babel, then `eval`'d via `vm.runInThisContext`.
Both steps pay a per-process cost in every `pi` invocation.

Per-package cost on warm cache:
- `pi-background-tasks` (49 .ts files, 9.7k LOC): **1.3s**
- `pi-subagents` (287 .ts files): 0.8s
- `@juicesharp/rpiv-todo` (16 .ts files): 0.55s
- `ponytail` (skill only): 0.2s
- Skills total: 0.3s
- Everything else: ~0.5s (node startup, main bundle parse)

Total extensions: **~2.2s out of 2.5s**. Skills add ~0.3s. Disabling both
(`-ne -ns`) brings startup to **0.5s** but loses all tools.

## Fix

Pre-compile user extension `.ts` files to `.js` alongside them.
Jiti then imports them via Node's native ESM loader (no babel transform,
no `vm.runInThisContext`). The `.ts` source `import './common.js'` paths
already match the new `.js` files, so no source edits are needed.

Result: **~50% faster startup** (2.5s → 1.3s).

### Run

```
~/.pi/agent/bin/pi-compile-extensions
```

Re-run after `pi npm install` or extension updates. To revert, delete
the generated `.js` files inside each package's `src/` tree.

### Skipped: `~/.pi/agent/extensions/`

This directory uses filename-based scanning (loads both `.ts` and `.js`).
Adding `.js` files here causes "Tool X conflicts with Y" errors.
The 6 user extensions here contribute only ~0.05s anyway.

### Skipped: dependency `.ts` files

Only the packages in `settings.json → packages` are compiled. The 1400+
`.ts` files in `node_modules/<dep>/` (jiti, defuddle, undici, etc.) are
left untouched — they're already loaded as fast native code.

## Cache note

The jiti fsCache lives at `/tmp/jiti/` (ext4 here, survives reboots).
After clearing it (cold cache), startup is ~16s even with the .js files,
because V8 must re-parse everything. Warm cache (normal usage): 1.3s.

If you reboot often or wipe `/tmp`, consider symlinking jiti cache to
a persistent location: `ln -sf ~/.cache/jiti /tmp/jiti`.
