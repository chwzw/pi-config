// Companion to herdr-agent-state.ts, which herdr manages and rewrites on
// `herdr integration install pi`. That file can only learn about a waiting
// prompt from the `herdr:blocked` event, and nothing emits it: pi announces
// every ctx.ui.select/confirm/input/editor/custom prompt through its own
// `ui_prompt_start` / `ui_prompt_end` events (nested prompts are coalesced
// into one outer span), so this bridges the two.
//
// Without it Herdr keeps showing `working`/`idle` while pi sits on a question,
// because screen detection is disabled for pi
// (screen_detection_skip_reason: full_lifecycle_hook_authority).

const KIND_LABELS: Record<string, string> = {
	select: "Waiting for a selection",
	confirm: "Waiting for confirmation",
	input: "Waiting for input",
	editor: "Waiting for your answer",
	custom: "Waiting for your answer",
};

export default function herdrBlockedBridge(pi: any) {
	let waiting = false;

	pi.on("ui_prompt_start", (event: any) => {
		if (waiting) return;
		waiting = true;

		const title = typeof event?.title === "string" ? event.title.split("\n")[0].trim() : "";
		const label = title
			? title.slice(0, 120)
			: (KIND_LABELS[event?.kind] ?? "Waiting for your answer");

		pi.events.emit("herdr:blocked", { active: true, label });
	});

	pi.on("ui_prompt_end", () => {
		if (!waiting) return;
		waiting = false;
		pi.events.emit("herdr:blocked", { active: false });
	});
}
