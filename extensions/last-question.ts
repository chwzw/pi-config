import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { UserMessage } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-tui";

// Local alias for the UserMessage content shape we receive from message_start.
type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; [k: string]: unknown };
type UserContent = string | (TextContent | ImageContent)[];

const WIDGET_KEY = "last-question";

/** Returns true if the prompt is not a real "question" we want to display. */
export function shouldSuppress(content: UserContent): boolean {
	if (typeof content === "string") {
		const trimmed = content.trim();
		if (trimmed.length === 0) return true;
		if (trimmed.startsWith("/")) return true;
		if (trimmed.startsWith("!")) return true;
		return false;
	}
	// Array form: image-only counts as suppress.
	const hasText = content.some((c) => c.type === "text" && c.text.trim().length > 0);
	return !hasText;
}

/** Extracts text, image count, and line count from a UserMessage's content. */
export function extractTextAndImageCount(
	content: UserContent,
): { text: string; imageCount: number; lineCount: number } {
	if (typeof content === "string") {
		return { text: content, imageCount: 0, lineCount: content.split("\n").length };
	}
	const texts: string[] = [];
	let imageCount = 0;
	for (const part of content) {
		if (part.type === "text") texts.push(part.text);
		else imageCount += 1;
	}
	const text = texts.join("\n");
	return { text, imageCount, lineCount: text.split("\n").length };
}

/** Renders the single-line widget text, truncated to terminal width. */
export function formatWidgetLine(
	text: string,
	imageCount: number,
	lineCount: number,
	terminalWidth: number,
	theme: Theme,
): string {
	const label = theme.fg("dim", "↳ last question:");

	// Take only the first line of multi-line prompts.
	const firstLine = text.split("\n")[0] ?? "";

	// Truncate body to fit terminal width (label is 18 cols; leave 4 col padding).
	// Floor at 1 so narrow terminals still truncate instead of overflowing.
	const maxBody = Math.max(1, terminalWidth - 22);
	let body = firstLine;
	if (body.length > maxBody) {
		body = body.slice(0, Math.max(1, maxBody - 1)) + "…";
	}

	// Suffix: line-count hint, then image indicator.
	const more = lineCount > 1 ? theme.fg("dim", ` (+${lineCount - 1} more)`) : "";
	const imgs = imageCount > 0 ? theme.fg("dim", ` 📷 ${imageCount}`) : "";

	const accented = theme.fg("accent", body);
	return `${label} ${accented}${more}${imgs}`;
}

/** Walks the branch backward to find the last user message that should be displayed.
 * `skipFromEnd` excludes the most recent N entries (used to skip a message we just emitted). */
function findLastUserMessage(
	getBranch: () => readonly unknown[],
	skipFromEnd: number,
): UserMessage | null {
	const branch = getBranch();
	for (let i = branch.length - 1 - skipFromEnd; i >= 0; i--) {
		const entry = branch[i] as { type?: string; message?: { role?: string; content?: unknown } } | undefined;
		if (!entry || entry.type !== "message") continue;
		const msg = entry.message;
		if (!msg || msg.role !== "user") continue;
		if (shouldSuppress(msg.content as UserContent)) continue;
		return msg as UserMessage;
	}
	return null;
}

function getTerminalWidth(): number {
	const cols = process.stdout.columns;
	return typeof cols === "number" && cols > 0 ? cols : 80;
}

function renderWidget(msg: UserMessage, ctx: { ui: { setWidget: (k: string, lines: string[] | undefined) => void; theme: Theme } }): void {
	if (shouldSuppress(msg.content)) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return;
	}
	const { text, imageCount, lineCount } = extractTextAndImageCount(msg.content);
	const line = formatWidgetLine(text, imageCount, lineCount, getTerminalWidth(), ctx.ui.theme);
	ctx.ui.setWidget(WIDGET_KEY, [line]);
}

export default function lastQuestionExtension(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		const last = findLastUserMessage(() => ctx.sessionManager.getBranch(), 0);
		if (last) {
			renderWidget(last, ctx);
		} else {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		}
	});

	pi.on("message_start", (event, ctx) => {
		if (!ctx.hasUI) return;
		const msg = event.message;
		if (msg.role !== "user") return;

		if (shouldSuppress(msg.content)) {
			// Suppressed input (slash command, !bash, image-only, etc.).
			// Don't blank the widget — fall back to the previous displayable question.
			const prior = findLastUserMessage(() => ctx.sessionManager.getBranch(), 1);
			if (prior) {
				renderWidget(prior, ctx);
			} else {
				ctx.ui.setWidget(WIDGET_KEY, undefined);
			}
			return;
		}

		renderWidget(msg as UserMessage, ctx);
	});
}