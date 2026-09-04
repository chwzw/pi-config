import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** A single Q-and-A exchange shown in the widget. */
export interface BtwSlotLike {
	question: string;
	answer: string;
	thinking: string;
	toolActivities: ReadonlyArray<ToolActivityLike>;
	done: boolean;
}

export interface ToolActivityLike {
	name: string;
	argsSummary: string;
	resultSummary: string;
	isError: boolean;
}

/** Theme callbacks the renderer needs. Pure string-in / string-out. */
export interface BtwColors {
	dim: (s: string) => string;
	success: (s: string) => string;
	warning: (s: string) => string;
	error: (s: string) => string;
	italic: (s: string) => string;
}

/** Frame element of the bordered widget.
 *  - `top` / `bottom` are the rounded-cap bars (`╭…╮` and `╰…╯`).
 *  - `line` is a piece of content rendered with a left border (`│ `) on every
 *    wrapped line. The renderer wraps the text so multi-line content
 *    (whether due to explicit `\n` or terminal width) keeps the border. */
export type BtwLineSegment =
	| { kind: "top" }
	| { kind: "bottom" }
	| { kind: "line"; text: string };

/** Format one tool activity as a single string. Result preview, if any,
 *  is added on a new line indented with two spaces; the renderer will wrap
 *  and re-prefix every resulting line. */
export function formatToolActivity(
	activity: ToolActivityLike,
	colorOk: (s: string) => string,
	colorErr: (s: string) => string,
): string {
	const label = activity.name + (activity.argsSummary ? ` ${activity.argsSummary}` : "");
	const status = activity.isError ? colorErr("✗") : colorOk("✓");
	return `${status} ${label}` + (activity.resultSummary ? `\n  ${activity.resultSummary}` : "");
}

/** Build the frame segments (top, content lines, bottom) from current state.
 *  Pure: no side effects, no I/O. Test with mock color functions. */
export function buildBtwSegments(
	slots: ReadonlyArray<BtwSlotLike>,
	status: string | null,
	colors: BtwColors,
): BtwLineSegment[] {
	const segments: BtwLineSegment[] = [{ kind: "top" }];

	for (let i = 0; i < slots.length; i++) {
		const s = slots[i];
		if (i > 0) segments.push({ kind: "line", text: "───" });
		segments.push({ kind: "line", text: colors.success("› ") + s.question });

		for (const act of s.toolActivities) {
			segments.push({ kind: "line", text: formatToolActivity(act, colors.success, colors.error) });
		}

		if (s.thinking) {
			const cursor =
				!s.answer && s.toolActivities.length === 0 && !s.done ? colors.warning(" ▍") : "";
			segments.push({ kind: "line", text: colors.italic(s.thinking) + cursor });
		}
		if (s.answer) {
			const cursor = !s.done ? colors.warning(" ▍") : "";
			segments.push({ kind: "line", text: s.answer + cursor });
		} else if (!s.thinking && s.toolActivities.length === 0 && !s.done) {
			segments.push({ kind: "line", text: colors.warning("⏳ thinking...") });
		}
	}

	if (status) {
		segments.push({ kind: "line", text: colors.warning(status) });
	}

	segments.push({ kind: "bottom" });
	return segments;
}

/** Render the segments as full output lines for a given terminal width.
 *
 *  Layout: the top/bottom bars occupy the full `width` (using `╭…╮` / `╰…╯`).
 *  Content lines are exactly `width` chars too: 2 for `│ `, the rest for text.
 *  Each piece of content is word-wrapped to the available inner width so that
 *  long lines and explicit `\n` both produce one bordered line per row.
 *
 *  Graceful on narrow terminals: when the inner area can't fit the title,
 *  the bar collapses to just dashes; when it can't fit `│ ` either, we
 *  still emit `│` so the structural prefix is preserved. */
export function renderBtwLines(
	segments: ReadonlyArray<BtwLineSegment>,
	width: number,
	dim: (s: string) => string,
): string[] {
	if (width <= 0) return [];

	const inner = width - 2; // chars between ╭╮ (or ╰╯)
	const lines: string[] = [];

	if (inner < 0) {
		// Width < 2 — at most we can show a single cap character per row.
		for (const seg of segments) {
			if (seg.kind === "top" || seg.kind === "bottom") {
				lines.push(dim(seg.kind === "top" ? "╭" : "╯"));
			} else {
				lines.push(dim("│"));
			}
		}
		return lines;
	}

	const title = " 💭 btw ";
	const hint = " /btw:clear to dismiss ";

	for (const seg of segments) {
		if (seg.kind === "top") {
			let bar: string;
			if (inner >= title.length + hint.length) {
				bar =
					"╭" +
					title +
					"─".repeat(inner - title.length - hint.length) +
					hint +
					"╮";
			} else if (inner >= title.length) {
				bar = "╭" + title + "─".repeat(inner - title.length) + "╮";
			} else {
				bar = "╭" + "─".repeat(inner) + "╮";
			}
			lines.push(dim(bar));
			continue;
		}
		if (seg.kind === "bottom") {
			lines.push(dim("╰" + "─".repeat(inner) + "╯"));
			continue;
		}

		// Content line: prefix is "│ " (2 chars) plus the text.
		// Available text width: inner - 2.
		const textWidth = inner - 2;
		if (textWidth <= 0) {
			// Only the prefix fits.
			lines.push(dim("│ "));
			continue;
		}
		const wrapped = wrapTextWithAnsi(seg.text, textWidth);
		for (const w of wrapped) {
			lines.push(dim("│ ") + w);
		}
	}

	return lines;
}
