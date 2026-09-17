import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { relative, resolve, sep, isAbsolute } from "node:path";
const BAR_WIDTH = 12;
const FILLED = "\u2588";
const EMPTY = "\u2591";
function formatTokens(count) {
  if (count < 1e3) return count.toString();
  if (count < 1e4) return `${(count / 1e3).toFixed(1)}k`;
  if (count < 1e6) return `${Math.round(count / 1e3)}k`;
  if (count < 1e7) return `${(count / 1e6).toFixed(1)}M`;
  return `${Math.round(count / 1e6)}M`;
}
function formatCwdForFooter(cwd, home) {
  if (!home) return cwd;
  const rCwd = resolve(cwd), rHome = resolve(home);
  const rel = relative(rHome, rCwd);
  const inside = rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  if (!inside) return cwd;
  return rel === "" ? "~" : `~${sep}${rel}`;
}
function sanitizeStatusText(text) {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}
function barColor(percent) {
  if (percent == null) return "muted";
  if (percent >= 95) return "error";
  if (percent >= 80) return "warning";
  return "accent";
}
function buildBar(percent, theme) {
  const filled = percent == null ? 0 : Math.min(BAR_WIDTH, Math.max(0, Math.round(percent / 100 * BAR_WIDTH)));
  const filledStr = theme.fg(barColor(percent), FILLED.repeat(filled));
  const emptyStr = theme.fg("dim", EMPTY.repeat(BAR_WIDTH - filled));
  return "[" + filledStr + emptyStr + "]";
}
function context_bar_footer_default(pi) {
  const install = async (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const disposeBranch = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: disposeBranch,
        invalidate() {
        },
        render(width) {
          const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
          let latestCacheHitRate;
          for (const entry of ctx.sessionManager.getEntries()) {
            let usage = null;
            if (entry.type === "message" && entry.message.role === "assistant") {
              usage = entry.message.usage;
              if (usage) {
                const lpt = usage.input + usage.cacheRead + usage.cacheWrite;
                latestCacheHitRate = lpt > 0 ? usage.cacheRead / lpt * 100 : void 0;
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
          const cusage = ctx.getContextUsage();
          const ctxWindow = cusage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const ctokens = cusage?.tokens ?? null;
          const cpercent = cusage?.percent ?? null;
          const parts = [];
          if (totals.input) parts.push(theme.fg("dim", `\u2191${formatTokens(totals.input)}`));
          if (totals.output) parts.push(theme.fg("dim", `\u2193${formatTokens(totals.output)}`));
          if (totals.cacheRead) parts.push(theme.fg("dim", `R${formatTokens(totals.cacheRead)}`));
          if (totals.cacheWrite) parts.push(theme.fg("dim", `W${formatTokens(totals.cacheWrite)}`));
          if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && latestCacheHitRate !== void 0) {
            parts.push(theme.fg("dim", `CH${latestCacheHitRate.toFixed(1)}%`));
          }
          if (totals.cost) {
            parts.push(theme.fg("dim", `$${totals.cost.toFixed(3)}`));
          }
          const pctDisplay = cpercent === null ? "?" : `${cpercent.toFixed(1)}%`;
          const windowDisplay = formatTokens(ctxWindow);
          const barAndTokens = `${buildBar(cpercent, theme)} ${pctDisplay}/${windowDisplay}`;
          parts.push(theme.fg("dim", barAndTokens));
          if (process.env.PI_EXPERIMENTAL === "1") {
            parts.push(`${theme.fg("dim", "\u2022")} ${theme.bold(theme.fg("warning", "xp"))}`);
          }
          let statsLeft = parts.join(" ");
          if (visibleWidth(statsLeft) > width) {
            statsLeft = truncateToWidth(statsLeft, width, "...");
          }
          let right = ctx.model?.id || "no-model";
          if (ctx.model?.reasoning) {
            const tl = ctx.thinkingLevel || "off";
            right = tl === "off" ? `${right} \u2022 thinking off` : `${right} \u2022 ${tl}`;
          }
          if (footerData.getAvailableProviderCount?.() > 1 && ctx.model) {
            const withProvider = `(${ctx.model.provider}) ${right}`;
            if (visibleWidth(statsLeft) + 2 + visibleWidth(withProvider) <= width) {
              right = withProvider;
            }
          }
          const rightDim = theme.fg("dim", right);
          const statsLeftWidth = visibleWidth(statsLeft);
          const rightWidth = visibleWidth(rightDim);
          const padding = " ".repeat(Math.max(0, width - statsLeftWidth - rightWidth));
          const statsLine = width - statsLeftWidth - 2 >= rightWidth ? statsLeft + padding + rightDim : statsLeft;
          const cwd = ctx.sessionManager.getCwd?.() ?? process.cwd();
          let pwd = formatCwdForFooter(cwd, process.env.HOME || process.env.USERPROFILE || "");
          const branch = footerData.getGitBranch();
          if (branch) pwd = `${pwd} (${branch})`;
          const sessionName = ctx.sessionManager.getSessionName?.();
          if (sessionName) pwd = `${pwd} \u2022 ${sessionName}`;
          const lines = [truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")), statsLine];
          const MODE_KEYS = /* @__PURE__ */ new Set(["caveman", "ponytail"]);
          const entries = Array.from(footerData.getExtensionStatuses().entries()).sort(([a], [b]) => a.localeCompare(b));
          const modeText = entries.filter(([k]) => MODE_KEYS.has(k)).map(([, text]) => sanitizeStatusText(text)).join(" ");
          const otherText = entries.filter(([k]) => !MODE_KEYS.has(k)).map(([, text]) => sanitizeStatusText(text)).join(" ");
          if (otherText) lines.push(truncateToWidth(otherText, width, theme.fg("dim", "...")));
          if (modeText) lines.push(truncateToWidth(modeText, width, theme.fg("dim", "...")));
          return lines;
        }
      };
    });
  };
  pi.on("session_start", install);
}
export {
  context_bar_footer_default as default
};
