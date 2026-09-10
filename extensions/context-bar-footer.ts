/**
 * Status-bar footer: identical to pi's default footer, except the
 * context-usage segment (e.g. "41.2%/200k") is replaced with a visual
 * progress bar.
 *
 * Drop into ~/.pi/agent/extensions/context-bar-footer.ts (this folder),
 * then run `/reload` (or restart pi) to activate.
 *
 * Restore the default footer any time with: `pi --no-extensions` for
 * one run, or delete this file and `/reload`.
 */

// @ts-nocheck

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { relative, resolve, sep, isAbsolute } from "node:path";

const BAR_WIDTH = 12;
const FILLED = "█";
const EMPTY = "░";

/** Copy of the built-in footer's formatTokens (dist/.../footer.js). */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Copy of the built-in footer's formatCwdForFooter. */
function formatCwdForFooter(cwd: string, home: string): string {
	if (!home) return cwd;
	const rCwd = resolve(cwd), rHome = resolve(home);
	const rel = relative(rHome, rCwd);
	const inside =
		rel === "" ||
		(rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
	if (!inside) return cwd;
	return rel === "" ? "~" : `~${sep}${rel}`;
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function barColor(percent: number | null): string {
	if (percent == null) return "muted";
	if (percent >= 95) return "error";
	if (percent >= 80) return "warning";
	return "accent";
}

function buildBar(percent: number | null, theme: any): string {
	const filled =
		percent == null
			? 0
			: Math.min(BAR_WIDTH, Math.max(0, Math.round((percent / 100) * BAR_WIDTH)));
	const filledStr = theme.fg(barColor(percent), FILLED.repeat(filled));
	const emptyStr = theme.fg("dim", EMPTY.repeat(BAR_WIDTH - filled));
	return "[" + filledStr + emptyStr + "]";
}

export default function (pi: ExtensionAPI) {
	const install = async (_event: unknown, ctx: any) => {
		ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
			const disposeBranch = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: disposeBranch,
				invalidate() {},
				render(width: number): string[] {
					// -- Usage totals from all session entries (mirrors default footer) --
					const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
					let latestCacheHitRate: number | undefined;
					for (const entry of ctx.sessionManager.getEntries()) {
						let usage = null;
						if (entry.type === "message" && entry.message.role === "assistant") {
							usage = entry.message.usage;
							if (usage) {
								const lpt = usage.input + usage.cacheRead + usage.cacheWrite;
								latestCacheHitRate =
									lpt > 0 ? (usage.cacheRead / lpt) * 100 : undefined;
							}
						} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
							usage = entry.message.usage;
						} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
							usage = entry.usage;
						}
						if (!usage) continue;
						totals.input += usage.input;
						totals.output += usage.output;
						totals.cacheRead += usage.cacheRead;
						totals.cacheWrite += usage.cacheWrite;
						totals.cost += usage.cost?.total ?? 0;
					}

					// -- Context usage (the segment this extension replaces with a bar) --
					const cusage = ctx.getContextUsage();
					const ctxWindow: number = cusage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const ctokens: number | null = cusage?.tokens ?? null;
					const cpercent: number | null = cusage?.percent ?? null;

					// -- Stats line: dim non-context parts; context segment colored per default --
					const parts: string[] = [];
					if (totals.input) parts.push(theme.fg("dim", `↑${formatTokens(totals.input)}`));
					if (totals.output) parts.push(theme.fg("dim", `↓${formatTokens(totals.output)}`));
					if (totals.cacheRead) parts.push(theme.fg("dim", `R${formatTokens(totals.cacheRead)}`));
					if (totals.cacheWrite) parts.push(theme.fg("dim", `W${formatTokens(totals.cacheWrite)}`));
					if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && latestCacheHitRate !== undefined) {
						parts.push(theme.fg("dim", `CH${latestCacheHitRate.toFixed(1)}%`));
					}
					if (totals.cost) {
						// ponytail: default footer also shows "(sub)" for kimi-coding; needs
						// modelRuntime internals the extension API doesn't expose. Add if it matters.
						parts.push(theme.fg("dim", `$${totals.cost.toFixed(3)}`));
					}

					const pctDisplay =
						cpercent === null ? "?" : `${cpercent.toFixed(1)}%`;
					const windowDisplay = formatTokens(ctxWindow);
					const barAndTokens = `${buildBar(cpercent, theme)} ${pctDisplay}/${windowDisplay}`;
					// Color the bar itself; keep the text neutral (bar color already signals level).
					parts.push(theme.fg("dim", barAndTokens));

					if (process.env.PI_EXPERIMENTAL === "1") {
						parts.push(`${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`);
					}
					let statsLeft = parts.join(" ");
					if (visibleWidth(statsLeft) > width) {
						statsLeft = truncateToWidth(statsLeft, width, "...");
					}

					// -- Right side: model (provider) • thinking --
					let right = ctx.model?.id || "no-model";
					if (ctx.model?.reasoning) {
						const tl = ctx.thinkingLevel || "off";
						right = tl === "off" ? `${right} • thinking off` : `${right} • ${tl}`;
					}
					if (footerData.getAvailableProviderCount?.() > 1 && ctx.model) {
						const withProvider = `(${ctx.model.provider}) ${right}`;
						if (visibleWidth(statsLeft) + 2 + visibleWidth(withProvider) <= width) {
							right = withProvider;
						}
					}
					const rightDim = theme.fg("dim", right);

					// -- Assemble stats line (default alignment: right-pad model) --
					const statsLeftWidth = visibleWidth(statsLeft);
					const rightWidth = visibleWidth(rightDim);
					const padding = " ".repeat(Math.max(0, width - statsLeftWidth - rightWidth));
					const statsLine =
						width - statsLeftWidth - 2 >= rightWidth
							? statsLeft + padding + rightDim
							: statsLeft;

					// -- Line 1: pwd (dim, truncated) --
					const cwd = ctx.sessionManager.getCwd?.() ?? process.cwd();
					let pwd = formatCwdForFooter(cwd, process.env.HOME || process.env.USERPROFILE || "");
					const branch = footerData.getGitBranch();
					if (branch) pwd = `${pwd} (${branch})`;
					const sessionName = ctx.sessionManager.getSessionName?.();
					if (sessionName) pwd = `${pwd} • ${sessionName}`;

					const lines = [truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")), statsLine];

					// -- Extension statuses — modes (caveman/ponytail) on their own line,
					// everything else (background-tasks dock, etc.) on a separate line —
					const MODE_KEYS = new Set(["caveman", "ponytail"]);
					const entries = Array.from(footerData.getExtensionStatuses().entries())
						.sort(([a], [b]) => a.localeCompare(b));
					const modeText = entries
						.filter(([k]) => MODE_KEYS.has(k))
						.map(([, text]) => sanitizeStatusText(text))
						.join(" ");
					const otherText = entries
						.filter(([k]) => !MODE_KEYS.has(k))
						.map(([, text]) => sanitizeStatusText(text))
						.join(" ");
					if (otherText) lines.push(truncateToWidth(otherText, width, theme.fg("dim", "...")));
					if (modeText) lines.push(truncateToWidth(modeText, width, theme.fg("dim", "...")));
					return lines;
				},
			};
		});
	};

	pi.on("session_start", install);
}