/**
 * caveman-auto — auto-activate caveman mode at pi session start.
 *
 * Mimics the SessionStart activation hook from JuliusBrussee/caveman
 * (src/hooks/caveman-activate.js, .codex/hooks.json) for Claude Code,
 * Codex, and opencode:
 *
 *   1. On a new session (startup/new/fork) resolve the default mode —
 *      CAVEMAN_DEFAULT_MODE env, then .caveman.json / .caveman/config.json
 *      walking up from cwd, else "full".
 *   2. On resume, restore the mode this session had (per-session store,
 *      keyed by session file — mirrors the official per-session state).
 *   3. Inject the caveman ruleset once at the first turn of each session
 *      start (like the SessionStart hook emitting hidden context). Rules
 *      are read at runtime from ~/.pi/agent/caveman/SKILL.md and
 *      filtered to the active intensity level, same as the official hook.
 *   4. /caveman [lite|full|ultra|wenyan[-lite|-full|-ultra]|off] command,
 *      input triggers ("caveman mode", "less tokens", ...), stop triggers
 *      ("stop caveman", "normal mode"). Mode persists per session.
 *
 * Differences vs. the Claude/Codex hooks: pi has no stdin-hook protocol, so
 * the ruleset is injected as a hidden persistent message at before_agent_start
 * instead of SessionStart stdout. /startup, /clear, /new all reset to the
 * configured default; /resume and /fork keep the stored mode.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VALID_MODES = [
  "off",
  "lite",
  "full",
  "ultra",
  "wenyan-lite",
  "wenyan",
  "wenyan-full",
  "wenyan-ultra",
] as const;
type Mode = (typeof VALID_MODES)[number];

const MODE_ALIASES: Record<string, Mode> = { wenyan: "wenyan-full" };

const SKILL_CANDIDATES = [
  path.join(os.homedir(), ".pi", "agent", "caveman", "SKILL.md"),
  path.join(os.homedir(), ".agents", "skills", "caveman", "SKILL.md"),
];

// --- state store: ~/.pi/agent/caveman-state.json, { [sessionFile]: mode } ---
function statePath(): string {
  return path.join(os.homedir(), ".pi", "agent", "caveman-state.json");
}

function readState(): Record<string, Mode> {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8")) as Record<string, Mode>;
  } catch {
    return {};
  }
}

function writeState(state: Record<string, Mode>): void {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
  } catch {
    // state persistence is best-effort; never block app startup
  }
}

// --- default-mode resolution, mirrors official fallbackGetDefaultMode ---
function defaultModeFromFile(file: string): Mode | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const mode = typeof raw?.defaultMode === "string" ? raw.defaultMode.toLowerCase() : "";
    if ((VALID_MODES as readonly string[]).includes(mode)) return mode as Mode;
  } catch {
    /* unreadable or malformed → next source */
  }
  return null;
}

function getDefaultMode(): Mode {
  const env = process.env.CAVEMAN_DEFAULT_MODE;
  if (env && (VALID_MODES as readonly string[]).includes(env.toLowerCase())) {
    return env.toLowerCase() as Mode;
  }
  let dir = process.cwd();
  for (let i = 0; i < 64; i++) {
    for (const rel of [".caveman/config.json", ".caveman.json"]) {
      const mode = defaultModeFromFile(path.join(dir, rel));
      if (mode) return mode;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "full";
}

// --- ruleset, read from local SKILL.md at runtime (like the official hook),
//     filtered to the active level; hardcoded fallback if skill is absent ---
const FALLBACK_RULES = (mode: Mode): string => `
Respond terse like smart caveman. All technical substance stay. Only fluff die.

## Persistence

Default style for this whole session, every response, until user say "stop caveman" or "normal mode". Keep terse on long sessions — no filler drift.

Current level: **${mode}**. Switch: \`/caveman lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra\`.

## Rules

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Preserve user's dominant language. Compress the style, not the language. Technical terms, code, API names, commands, error strings stay verbatim.

Answer directly in this style. Skip "caveman mode on" tags or a "Caveman:" recap — redundant with the reply itself.

Pattern: \`[thing] [action] [reason]. [next step].\`

Not: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Yes: "Bug in auth middleware. Token expiry check use \`<\` not \`<=\`. Fix:"

## Auto-Clarity

Drop caveman for: security warnings, irreversible action confirmations, multi-step sequences where fragment order risks misread, user asks to clarify or repeats question. Resume caveman after clear part done.

## Boundaries

Code/commits/PRs: write normal. "stop caveman" or "normal mode": revert. Level persist until changed or session end.`;

function skillRulesFor(mode: Mode): string | null {
  const canonical = MODE_ALIASES[mode] ?? mode;
  for (const candidate of SKILL_CANDIDATES) {
    let content: string;
    try {
      content = fs.readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
    const body = content.replace(/^---[\s\S]*?---\s*/, "");
    const filtered = body.split("\n").reduce((acc: string[], line: string) => {
      const tableRow = line.match(/^\|\s*\*\*(\S+?)\*\*\s*\|/);
      if (tableRow) {
        if (tableRow[1] === canonical) acc.push(line);
        return acc;
      }
      const example = line.match(/^- (\S+?):\s/);
      if (example) {
        if (example[1] === canonical) acc.push(line);
        return acc;
      }
      acc.push(line);
      return acc;
    }, []);
    return filtered.join("\n");
  }
  return null;
}

function buildRuleset(mode: Mode): string {
  if (mode === "off") {
    return "CAVEMAN MODE OFF — respond in normal prose. Earlier caveman rulesets in this history are superseded.";
  }
  const canonical = MODE_ALIASES[mode] ?? mode;
  const skill = skillRulesFor(mode);
  const body = skill ?? FALLBACK_RULES(mode);
  return `CAVEMAN MODE ACTIVE — level: ${canonical}\n\n${body}`;
}

// --- extension entry ---
export default function (pi: ExtensionAPI) {
  // in-memory mode for THIS process; authoritative across reloads via store
  let mode: Mode = getDefaultMode();
  let isActive = false;
  let lastCtx: any = null;
  const injectedSessions = new Set<string>(); // session files already injected this start

  // -- Status bar, mirrors the ponytail extension's syncStatus --
  const syncStatus = (ctx?: any): void => {
    if (ctx) lastCtx = ctx;
    const c = ctx || lastCtx;
    if (!c?.ui?.setStatus) return;
    // try/catch guards against pi-web theme proxy throwing before initTheme
    let theme;
    try { theme = c.ui.theme; if (!theme?.fg) return; } catch { return; }
    if (mode === "off") {
      c.ui.setStatus("caveman", "");
      return;
    }
    const levelIcons: Record<string, string> = { lite: "🌿", full: "⚡", ultra: "🔥" };
    const icon = levelIcons[mode] || "";
    const indicator = isActive ? theme.fg("accent", "●") : theme.fg("dim", "○");
    c.ui.setStatus("caveman", indicator + " 🪨 " + theme.fg("muted", "caveman: ") + theme.fg("text", icon + " " + mode.toUpperCase()));
  };

  const sessionKey = (file: string | null | undefined): string =>
    file && file.length > 0 ? file : "ephemeral";

  const persist = (key: string): void => {
    const state = readState();
    if (mode === "off") delete state[key];
    else state[key] = mode;
    writeState(state);
  };

  const setMode = (next: Mode, key: string | null, notify: boolean, ctx?: any): void => {
    if (next === mode) {
      if (notify) ctx?.ui?.notify(
        `Caveman already ${mode === "off" ? "off" : `active (${mode})`}.`, "info");
      return;
    }
    mode = next;
    if (key) persist(key);
    // drop the injection marker so the next turn re-injects the new ruleset
    // (appended at end of history — prefix cache stays intact)
    if (key) injectedSessions.delete(key);
    if (notify) ctx?.ui?.notify(
      mode === "off" ? "Caveman go away." : `Caveman mode active: ${mode}.`, "info");
    syncStatus(ctx);
  };

  // --- SessionStart semantics ---
  pi.on("session_start", async (event, ctx) => {
    const key = sessionKey(ctx.sessionManager.getSessionFile());
    // Reasons: "startup" | "reload" | "new" | "resume" | "fork".
    // Official RESET_SOURCES = startup | clear → new conversation resets to
    // the configured default; resume/fork keep the stored mode.
    if (event.reason === "resume" || event.reason === "fork") {
      const state = readState();
      mode = state[key] ?? getDefaultMode();
    } else if (event.reason !== "reload") {
      mode = getDefaultMode();
    }
    persist(key);
    // re-inject on the next turn of this (re)started session
    injectedSessions.delete(key);
    syncStatus(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    isActive = true;
    syncStatus(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    isActive = false;
    syncStatus(ctx);
  });

  // --- inject at first turn of each session start, once ---
  pi.on("before_agent_start", async (_event, ctx) => {
    // "off" also injects (a short supersede notice) so the model stops
    // following rulesets still present in history
    const key = sessionKey(ctx.sessionManager.getSessionFile());
    if (injectedSessions.has(key)) return;
    injectedSessions.add(key);
    return {
      message: {
        customType: "caveman-auto",
        content: buildRuleset(mode),
        display: false,
      },
    };
  });

  // --- /caveman command: toggle or set level ---
  pi.registerCommand("caveman", {
    description: "Toggle caveman mode — speak like caveman, fewer tokens",
    getArgumentCompletions: (prefix: string) =>
      VALID_MODES.filter((l) => l !== "wenyan")
        .map((l) => ({ value: l, label: l }))
        .filter((i) => i.value.startsWith(prefix)),
    handler: async (args, ctx) => {
      const key = sessionKey(ctx.sessionManager.getSessionFile());
      const arg = (args ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
      if (!arg) {
        setMode(mode === "off" ? "full" : "off", key, true, ctx);
        return;
      }
      const clean = arg.replace(/[^a-z-]/g, "");
      const target = MODE_ALIASES[clean] ?? (VALID_MODES as readonly string[]).includes(clean)
        ? (clean as Mode)
        : null;
      if (!target) {
        ctx.ui.notify(`Unknown level: ${args}. Use lite, full, ultra, wenyan, or off.`, "error");
        return;
      }
      setMode(target, key, true, ctx);
    },
  });

  // --- input triggers (deterministic mode switching + persistence) ---
  pi.on("input", async (event, ctx) => {
    const text = event.text.toLowerCase();
    const key = sessionKey(ctx.sessionManager.getSessionFile());

    const stopTriggers = ["stop caveman", "normal mode", "normal说话"];
    if (stopTriggers.some((s) => text.includes(s))) {
      setMode("off", key, true, ctx);
      return;
    }

    const triggers = [
      "caveman mode",
      "talk like caveman",
      "use caveman",
      "less tokens",
      "fewer tokens",
      "be brief",
    ];
    if (!triggers.some((t) => text.includes(t))) return;

    let target: Mode = "full";
    if (text.includes("wenyan-ultra")) target = "wenyan-ultra";
    else if (text.includes("wenyan-full") || text.includes("wenyan")) target = "wenyan-full";
    else if (text.includes("ultra")) target = "ultra";
    else if (text.includes("lite")) target = "lite";
    setMode(target, key, true, ctx);
  });
}