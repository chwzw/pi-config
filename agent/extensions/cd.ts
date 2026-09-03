import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	createLocalBashOperations,
	isToolCallEventType,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const PATH_TOOLS = ["read", "write", "edit", "grep", "find", "ls"] as const;

let effectiveCwd: string = process.cwd();
const originalCwd: string = process.cwd();

function resolveTarget(input: string): string {
	const expanded = input.startsWith("~")
		? path.join(os.homedir(), input.slice(1))
		: input;
	const resolved = path.resolve(effectiveCwd, expanded);
	if (!fs.existsSync(resolved)) {
		throw new Error(`Path not found: ${resolved}`);
	}
	if (!fs.statSync(resolved).isDirectory()) {
		throw new Error(`Not a directory: ${resolved}`);
	}
	return resolved;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("cd", {
		description: "Change the working directory for this session",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify(`cwd: ${effectiveCwd} (original: ${originalCwd})`, "info");
				return;
			}
			let target: string;
			try {
				target = resolveTarget(trimmed);
			} catch (err) {
				ctx.ui.notify((err as Error).message, "error");
				return;
			}

			process.chdir(target);
			effectiveCwd = target;
			(ctx.sessionManager as unknown as { cwd: string }).cwd = target;
			ctx.ui.notify(`cwd: ${originalCwd} → ${target}`, "info");
		},
	});

	pi.on("tool_call", (event) => {
		if (isToolCallEventType("bash", event)) {
			event.input.command = `cd ${JSON.stringify(effectiveCwd)} && ${event.input.command}`;
			return;
		}
		for (const name of PATH_TOOLS) {
			if (isToolCallEventType(name, event)) {
				const p = (event.input as { path?: unknown }).path;
				if (typeof p === "string" && p && !path.isAbsolute(p)) {
					(event.input as { path: string }).path = path.resolve(effectiveCwd, p);
				}
				return;
			}
		}
	});

	pi.on("user_bash", () => {
		const local = createLocalBashOperations();
		return {
			operations: {
				exec(command, _cwd, options) {
					return local.exec(command, effectiveCwd, options);
				},
			},
		};
	});
}