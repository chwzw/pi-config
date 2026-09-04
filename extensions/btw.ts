import { streamSimple, completeSimple, type Message } from "@earendil-works/pi-ai/compat";
import type {
	Tool as ApiTool,
	ToolCall,
	ToolResultMessage,
	AssistantMessage,
	ThinkingLevel,
} from "@earendil-works/pi-ai";
import {
	createReadOnlyTools,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { buildBtwSegments, renderBtwLines } from "./btw/btw-widget.ts";

interface BtwDetails {
	question: string;
	thinking: string;
	answer: string;
	model: string;
}

interface ToolActivity {
	name: string;
	argsSummary: string;
	resultSummary: string;
	isError: boolean;
}

interface BtwSlot {
	question: string;
	model: string;
	thinking: string;
	answer: string;
	toolActivities: ToolActivity[];
	done: boolean;
}

// Captured command ctx goes stale after the session is replaced or torn down
// (newSession / fork / switchSession / reload / shutdown). Every `ctx.ui.*`
// access throws once the runner is invalidated. We can't avoid that for the
// streaming widget path — the IIFE legitimately outlives the handler — so we
// swallow the throw once and stop touching ctx.ui afterwards. The stream and
// tool execution keep running; only widget redraws stop.
let uiBroken = false;
function safeRender(ctx: ExtensionContext, fn: () => void): void {
	if (uiBroken) return;
	try {
		fn();
	} catch (err: any) {
		if (err instanceof Error && /stale after session replacement or reload/.test(err.message)) {
			uiBroken = true;
			return;
		}
		throw err;
	}
}

const BTW_TYPE = "btw";
const BTW_RESET_TYPE = "btw-reset";
const MAX_TOOL_TURNS = 10;
const TOOL_RESULT_PREVIEW_CHARS = 200;

const emptyUsage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const BTW_SYSTEM_PROMPT =
	"You are having an aside conversation with the user, separate from their main working session. " +
	"The main session messages are provided for context only — that work is being handled by another agent. " +
	"You have read-only file tools (read, grep, find, ls) available to inspect the project when needed to answer the user's questions. " +
	"Use them only when they would meaningfully improve your answer. " +
	"Do not act as if you need to complete or continue the main session's work; do not run side-effectful tools.";

function summarizeArgs(name: string, args: any): string {
	if (!args || typeof args !== "object") return "";
	switch (name) {
		case "read":
			return String(args.path ?? "");
		case "grep":
			return `"${args.pattern}" in ${args.path ?? "."}"` + (args.include ? ` (${args.include})` : "");
		case "find":
			return `${args.pattern} in ${args.path ?? "."}`;
		case "ls":
			return String(args.path ?? ".");
		default:
			try {
				return JSON.stringify(args);
			} catch {
				return "";
			}
	}
}

function summarizeResult(content: Array<{ type: string; text?: string }>): string {
	const text = content
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("\n")
		.trim();
	if (!text) return "(no output)";
	const oneLine = text.replace(/\s+/g, " ");
	if (oneLine.length <= TOOL_RESULT_PREVIEW_CHARS) return oneLine;
	return oneLine.slice(0, TOOL_RESULT_PREVIEW_CHARS) + "…";
}

/**
 * /btw <question>      — Side conversation, streams answer in a widget
 * /btw:new <question>   — Fresh btw thread
 * /btw:clear            — Dismiss the widget
 * /btw:inject [msg]     — Inject full btw thread into main agent context
 * /btw:summarize [msg]  — Summarize btw thread and inject into main agent context
 */
export default function (pi: ExtensionAPI) {
	let btwThreadStart = 0;
	const pendingBtwThread: BtwDetails[] = [];

	// Active widget slots — each /btw call gets one, streams into it
	const slots: BtwSlot[] = [];
	let widgetStatus: string | null = null;

	// ── Restore state from session on reload/restart ─────────────────

	pi.on("session_start", async (_event, ctx) => {
		pendingBtwThread.length = 0;
		slots.length = 0;
		btwThreadStart = 0;
		uiBroken = false; // fresh runner — UI is usable again after reload/restart

		// Find the latest reset marker to know which btw entries are active
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && (entry as any).customType === BTW_RESET_TYPE) {
				btwThreadStart = (entry as any).data?.timestamp ?? 0;
			}
		}

		// Reconstruct thread from entries after the last reset
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || (entry as any).customType !== BTW_TYPE) continue;
			const entryTime = Date.parse(entry.timestamp) || 0;
			if (entryTime <= btwThreadStart) continue;
			const data = (entry as any).data as BtwDetails | undefined;
			if (data?.question && data?.answer && !data.answer.startsWith("❌")) {
				pendingBtwThread.push(data);
				slots.push({
					question: data.question,
					model: data.model,
					thinking: data.thinking || "",
					answer: data.answer,
					toolActivities: [],
					done: true,
				});
			}
		}

		if (slots.length > 0) {
			renderWidget(ctx);
		}
	});

	// ── Widget rendering ─────────────────────────────────────────────

	function renderWidget(ctx: ExtensionContext) {
		safeRender(ctx, () => {
			if (slots.length === 0) {
				ctx.ui.setWidget("btw", undefined);
				return;
			}

			ctx.ui.setWidget("btw", (_tui, theme) => {
				const dim = (s: string) => theme.fg("dim", s);
				const green = (s: string) => theme.fg("success", s);
				const italic = (s: string) => theme.fg("dim", theme.italic(s));
				const yellow = (s: string) => theme.fg("warning", s);
				const red = (s: string) => theme.fg("error", s);

				const colors = { dim, success: green, warning: yellow, error: red, italic };
				const segments = buildBtwSegments(slots, widgetStatus, colors);

				return {
					invalidate() {},
					render(width: number): string[] {
						return renderBtwLines(segments, width, dim);
					},
				};
			}, { placement: "aboveEditor" });
		});
	}

	// ── Helpers ──────────────────────────────────────────────────────

	/** Reset the btw thread — clears state and persists a reset marker */
	function resetThread(ctx: ExtensionContext) {
		btwThreadStart = Date.now();
		pendingBtwThread.length = 0;
		slots.length = 0;
		widgetStatus = null;
		pi.appendEntry(BTW_RESET_TYPE, { timestamp: btwThreadStart });
		renderWidget(ctx);
	}

	/** Collect btw thread — pendingBtwThread is the source of truth
	 *  (reconstructed from session on startup, appended live during session) */
	function collectBtwThread(): BtwDetails[] {
		return pendingBtwThread.filter((d) => !d.answer.startsWith("❌"));
	}

	function formatThread(thread: BtwDetails[]): string {
		return thread
			.map((d) => `User: ${d.question.trim()}\nAssistant: ${d.answer.trim()}`)
			.join("\n\n---\n\n");
	}

	function buildMainMessages(ctx: ExtensionContext, model: any): Message[] {
		const messages: Message[] = [];
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = (entry as any).message;
			if (!msg) continue;

			if (msg.role === "user") {
				const content =
					typeof msg.content === "string"
						? msg.content
						: (msg.content ?? [])
								.filter((c: any) => c.type === "text")
								.map((c: any) => c.text)
								.join("\n");
				if (content) {
					messages.push({
						role: "user",
						content: [{ type: "text", text: content }],
						timestamp: msg.timestamp ?? Date.now(),
					});
				}
			} else if (msg.role === "assistant") {
				const content = (msg.content ?? [])
					.filter((c: any) => c.type === "text")
					.map((c: any) => c.text)
					.join("\n");
				if (content) {
					messages.push({
						role: "assistant",
						content: [{ type: "text", text: content }],
						model: msg.model ?? model.id,
						provider: msg.provider ?? model.provider,
						api: msg.api ?? "",
						usage: msg.usage ?? emptyUsage,
						stopReason: "stop",
						timestamp: msg.timestamp ?? Date.now(),
					});
				}
			}
		}
		return messages;
	}

	function buildBtwMessages(ctx: ExtensionContext, model: any, question: string): Message[] {
		const mainMessages = buildMainMessages(ctx, model);
		const thread = collectBtwThread();
		const all: Message[] = [...mainMessages];

		if (thread.length > 0) {
			all.push({
				role: "user",
				content: [{ type: "text", text: "[The following is a separate side conversation. Continue this thread.]" }],
				timestamp: Date.now(),
			});
			all.push({
				role: "assistant",
				content: [{ type: "text", text: "Understood, continuing our side conversation." }],
				model: model.id, provider: model.provider, api: "",
				usage: emptyUsage, stopReason: "stop",
				timestamp: Date.now(),
			});
			for (const d of thread) {
				all.push({
					role: "user",
					content: [{ type: "text", text: d.question }],
					timestamp: Date.now(),
				});
				all.push({
					role: "assistant",
					content: [{ type: "text", text: d.answer }],
					model: model.id, provider: model.provider, api: "",
					usage: emptyUsage, stopReason: "stop",
					timestamp: Date.now(),
				});
			}
		}

		all.push({
			role: "user",
			content: [{ type: "text", text: question }],
			timestamp: Date.now(),
		});

		return all;
	}

	/** Build tool definitions for the LLM context + a map of executors */
	function prepareTools(cwd: string): { tools: ApiTool[]; executors: Map<string, AgentTool> } {
		const agentTools = createReadOnlyTools(cwd);
		const tools: ApiTool[] = agentTools.map((t) => ({
			name: t.name,
			description: t.description,
			parameters: t.parameters as any,
		}));
		const executors = new Map<string, AgentTool>();
		for (const t of agentTools) executors.set(t.name, t);
		return { tools, executors };
	}

	/** Run one streaming turn; if the model wants tools, execute them and loop. */
	async function runBtwTurn(
		ctx: ExtensionContext,
		slot: BtwSlot,
		messages: Message[],
		model: any,
		tools: ApiTool[],
		executors: Map<string, AgentTool>,
		auth: { apiKey?: string; headers?: Record<string, string> },
		reasoning: ThinkingLevel | undefined,
		turnCount: number,
	): Promise<void> {
		if (turnCount >= MAX_TOOL_TURNS) {
			slot.answer += "\n\n_(btw reached max tool turns — stopping)_";
			return;
		}

		const eventStream = streamSimple(
			model,
			{ systemPrompt: BTW_SYSTEM_PROMPT, messages, tools },
			{ apiKey: auth.apiKey, headers: auth.headers, reasoning },
		);

		let finalMessage: AssistantMessage | null = null;
		const completedToolCalls: ToolCall[] = [];

		for await (const event of eventStream) {
			if (event.type === "thinking_delta") {
				slot.thinking += event.delta;
				renderWidget(ctx);
			} else if (event.type === "text_delta") {
				slot.answer += event.delta;
				renderWidget(ctx);
			} else if (event.type === "toolcall_end") {
				completedToolCalls.push(event.toolCall);
				// Provisional activity entry — we'll fill in result after execution
				slot.toolActivities.push({
					name: event.toolCall.name,
					argsSummary: summarizeArgs(event.toolCall.name, event.toolCall.arguments),
					resultSummary: "(running...)",
					isError: false,
				});
				renderWidget(ctx);
			} else if (event.type === "done") {
				finalMessage = event.message;
			} else if (event.type === "error") {
				slot.answer += `\n❌ ${event.error.errorMessage ?? "Model request failed"}`;
				return;
			}
		}

		if (!finalMessage) {
			slot.answer += "\n❌ Stream ended without a final message";
			return;
		}

		// If the model didn't ask for tools, we're done.
		if (finalMessage.stopReason !== "toolUse") return;

		// Append the assistant message (containing tool calls) to the running context.
		messages.push(finalMessage);

		// Execute each tool call and append a ToolResultMessage for each.
		const toolCalls = finalMessage.content.filter((c): c is ToolCall => c.type === "toolCall");
		let activityIndex = slot.toolActivities.length - completedToolCalls.length;

		for (const tc of toolCalls) {
			const activity = slot.toolActivities[activityIndex++];
			const executor = executors.get(tc.name);
			let result;
			let isError = false;
			try {
				if (!executor) {
					result = { content: [{ type: "text", text: `❌ Unknown tool: ${tc.name}` }], details: undefined };
					isError = true;
				} else {
					result = await executor.execute(tc.id, tc.arguments, undefined, undefined);
				}
			} catch (err: any) {
				result = {
					content: [{ type: "text", text: `❌ ${err?.message ?? String(err)}` }],
					details: undefined,
				};
				isError = true;
			}

			if (activity) {
				activity.resultSummary = summarizeResult(result.content as any);
				activity.isError = isError;
			}

			const toolResult: ToolResultMessage = {
				role: "toolResult",
				toolCallId: tc.id,
				toolName: tc.name,
				content: result.content as any,
				details: result.details,
				isError,
				timestamp: Date.now(),
			};
			messages.push(toolResult);
		}

		renderWidget(ctx);

		// Continue the loop with the new messages.
		await runBtwTurn(ctx, slot, messages, model, tools, executors, auth, reasoning, turnCount + 1);
	}

	function fireBtw(ctx: ExtensionContext, question: string) {
		const model = ctx.model;
		if (!model) {
			ctx.ui.notify("No model selected", "error");
			return;
		}

		const { tools, executors } = prepareTools(ctx.cwd);
		// pi.getThinkingLevel() returns "off" | ThinkingLevel (from pi-agent-core);
		// streamSimple's reasoning option expects ThinkingLevel (pi-ai, without "off").
		const thinkingLevel = pi.getThinkingLevel();
		const reasoning: ThinkingLevel | undefined = thinkingLevel === "off" ? undefined : (thinkingLevel as ThinkingLevel);
		const modelLabel = `${model.provider}/${model.id}`;
		const allMessages = buildBtwMessages(ctx, model, question);

		// Create a slot for this btw call
		const slot: BtwSlot = {
			question,
			model: modelLabel,
			thinking: "",
			answer: "",
			toolActivities: [],
			done: false,
		};
		slots.push(slot);
		renderWidget(ctx);

		(async () => {
			try {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (!auth.ok) {
					slot.answer = `❌ ${auth.error}`;
					slot.done = true;
					renderWidget(ctx);
					return;
				}

				await runBtwTurn(ctx, slot, allMessages, model, tools, executors, auth, reasoning, 0);

				slot.done = true;
				renderWidget(ctx);

				const details: BtwDetails = {
					question,
					thinking: slot.thinking,
					answer: slot.answer,
					model: modelLabel,
				};
				pendingBtwThread.push(details);

				// Persist in session (hidden from TUI, filtered from agent context)
				pi.appendEntry(BTW_TYPE, details);
			} catch (err: any) {
				// Session was replaced/reloaded/shutdown while we were streaming.
				// Stop silently — the captured ctx is dead and we can't touch ctx.ui.
				// The widget will disappear via the runtime's resetExtensionUI hook.
				if (err instanceof Error && /stale after session replacement or reload/.test(err.message)) {
					return;
				}
				if (!uiBroken) {
					slot.answer = `❌ ${err.message}`;
					slot.done = true;
					renderWidget(ctx);
				}
			}
		})();
	}

	// ── Commands ─────────────────────────────────────────────────────

	pi.registerCommand("btw", {
		description: "Ask a side question using current context + read-only file tools (works async while agent is busy)",
		handler: async (args, ctx) => {
			const question = args.trim();
			if (!question) {
				ctx.ui.notify("Usage: /btw <question>", "warning");
				return;
			}
			fireBtw(ctx, question);
		},
	});

	pi.registerCommand("btw:new", {
		description: "Start a fresh btw thread, optionally with a new question",
		handler: async (args, ctx) => {
			resetThread(ctx);
			const question = args.trim();
			if (question) {
				fireBtw(ctx, question);
			} else {
				ctx.ui.notify("💭 btw: started fresh thread", "info");
			}
		},
	});

	pi.registerCommand("btw:clear", {
		description: "Dismiss the btw widget and clear thread",
		handler: async (_args, ctx) => {
			resetThread(ctx);
		},
	});

	pi.registerCommand("btw:inject", {
		description: "Inject btw thread into main agent context (queued as follow-up if busy) [optional instructions]",
		handler: async (args, ctx) => {
			const thread = collectBtwThread();
			if (thread.length === 0 || slots.length === 0) {
				ctx.ui.notify("No active btw thread to inject", "warning");
				return;
			}

			const instructions = args.trim();
			const threadText = formatThread(thread);
			const content = instructions
				? `Here's a side conversation I had. ${instructions}\n\n<btw-thread>\n${threadText}\n</btw-thread>`
				: `Here's a side conversation I had for additional context:\n\n<btw-thread>\n${threadText}\n</btw-thread>`;

			pi.sendUserMessage(content, { deliverAs: "followUp" });
			resetThread(ctx);
			ctx.ui.notify(`💭 btw → main: injected ${thread.length} exchange(s)`, "info");
		},
	});

	pi.registerCommand("btw:summarize", {
		description: "Summarize btw thread and inject into main agent (queued as follow-up if busy) [optional instructions]",
		handler: async (args, ctx) => {
			const thread = collectBtwThread();
			if (thread.length === 0 || slots.length === 0) {
				ctx.ui.notify("No active btw thread to summarize", "warning");
				return;
			}

			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				ctx.ui.notify(auth.error, "error");
				return;
			}

			widgetStatus = "⏳ summarizing...";
			renderWidget(ctx);

			try {
				const threadText = formatThread(thread);
				const response = await completeSimple(
					model,
					{
						messages: [
							{
								role: "user",
								content: [{
									type: "text",
									text: [
										"Summarize this side conversation concisely. Preserve key decisions, plans, insights, and action items.",
										"Output only the summary, no preamble.",
										"",
										"<btw-thread>",
										threadText,
										"</btw-thread>",
									].join("\n"),
								}],
								timestamp: Date.now(),
							},
						],
					},
					{ apiKey: auth.apiKey, headers: auth.headers, reasoning: "low" }
				);

				const summary = response.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n");

				const instructions = args.trim();
				const content = instructions
					? `Here's a summary of a side conversation I had. ${instructions}\n\n<btw-summary>\n${summary}\n</btw-summary>`
					: `Here's a summary of a side conversation I had:\n\n<btw-summary>\n${summary}\n</btw-summary>`;

				pi.sendUserMessage(content, { deliverAs: "followUp" });

				resetThread(ctx);
				ctx.ui.notify(`💭 btw → main: injected summary of ${thread.length} exchange(s)`, "info");
			} catch (err: any) {
				widgetStatus = null;
				renderWidget(ctx);
				ctx.ui.notify(`btw:summarize error — ${err.message}`, "error");
			}
		},
	});
}