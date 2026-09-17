const WIDGET_KEY = "last-question";
function shouldSuppress(content) {
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed.length === 0) return true;
    if (trimmed.startsWith("/")) return true;
    if (trimmed.startsWith("!")) return true;
    return false;
  }
  const hasText = content.some((c) => c.type === "text" && c.text.trim().length > 0);
  return !hasText;
}
function extractTextAndImageCount(content) {
  if (typeof content === "string") {
    return { text: content, imageCount: 0, lineCount: content.split("\n").length };
  }
  const texts = [];
  let imageCount = 0;
  for (const part of content) {
    if (part.type === "text") texts.push(part.text);
    else imageCount += 1;
  }
  const text = texts.join("\n");
  return { text, imageCount, lineCount: text.split("\n").length };
}
function formatWidgetLine(text, imageCount, lineCount, terminalWidth, theme) {
  const label = theme.fg("dim", "\u21B3 last question:");
  const firstLine = text.split("\n")[0] ?? "";
  const maxBody = Math.max(1, terminalWidth - 22);
  let body = firstLine;
  if (body.length > maxBody) {
    body = body.slice(0, Math.max(1, maxBody - 1)) + "\u2026";
  }
  const more = lineCount > 1 ? theme.fg("dim", ` (+${lineCount - 1} more)`) : "";
  const imgs = imageCount > 0 ? theme.fg("dim", ` \u{1F4F7} ${imageCount}`) : "";
  const accented = theme.fg("accent", body);
  return `${label} ${accented}${more}${imgs}`;
}
function findLastUserMessage(getBranch, skipFromEnd) {
  const branch = getBranch();
  for (let i = branch.length - 1 - skipFromEnd; i >= 0; i--) {
    const entry = branch[i];
    if (!entry || entry.type !== "message") continue;
    const msg = entry.message;
    if (!msg || msg.role !== "user") continue;
    if (shouldSuppress(msg.content)) continue;
    return msg;
  }
  return null;
}
function getTerminalWidth() {
  const cols = process.stdout.columns;
  return typeof cols === "number" && cols > 0 ? cols : 80;
}
function renderWidget(msg, ctx) {
  if (shouldSuppress(msg.content)) {
    ctx.ui.setWidget(WIDGET_KEY, void 0);
    return;
  }
  const { text, imageCount, lineCount } = extractTextAndImageCount(msg.content);
  const line = formatWidgetLine(text, imageCount, lineCount, getTerminalWidth(), ctx.ui.theme);
  ctx.ui.setWidget(WIDGET_KEY, [line]);
}
function lastQuestionExtension(pi) {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    const last = findLastUserMessage(() => ctx.sessionManager.getBranch(), 0);
    if (last) {
      renderWidget(last, ctx);
    } else {
      ctx.ui.setWidget(WIDGET_KEY, void 0);
    }
  });
  pi.on("message_start", (event, ctx) => {
    if (!ctx.hasUI) return;
    const msg = event.message;
    if (msg.role !== "user") return;
    if (shouldSuppress(msg.content)) {
      const prior = findLastUserMessage(() => ctx.sessionManager.getBranch(), 1);
      if (prior) {
        renderWidget(prior, ctx);
      } else {
        ctx.ui.setWidget(WIDGET_KEY, void 0);
      }
      return;
    }
    renderWidget(msg, ctx);
  });
}
export {
  lastQuestionExtension as default,
  extractTextAndImageCount,
  formatWidgetLine,
  shouldSuppress
};
