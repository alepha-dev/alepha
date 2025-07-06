import { exec } from "node:child_process";
import { join } from "node:path";
import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const timers: Array<{
	time: string;
	out: string;
	name: string;
}> = [];

export const log = (...args: string[]) => {
	if (logOptions.verbose) {
		console.log(
			`[${new Date().toISOString().split("T")[1].slice(0, -1)}]`,
			...args,
		);
	} else {
		console.log(...args);
	}
};

export const logOptions = {
	verbose: false,
};

export const now = Date.now();

export interface Flag {
	when: string[];
	description?: string;
	type?: TSchema;
	image?: string;
	default?: string;
}

export type Flags = {
	[key: string]: Flag;
};

export type InferFlags<T extends Flags> = {
	[K in keyof T]: T[K] extends Flag
		? T[K]["type"] extends TSchema
			? Static<T[K]["type"]>
			: boolean
		: never;
};

export interface CreateCommand<T extends Flags> {
	when?: string[];
	handler: (ctx: { flags: InferFlags<T>; run: Runner }) => void | Promise<void>;
	description: string;
	skipSummary?: boolean;
	flags?: T;
}

export interface Command<T extends Flags> {
	when?: string[];
	handler: (ctx: { flags: InferFlags<T>; run: Runner }) => void | Promise<void>;
	description: string;
	skipSummary?: boolean;
	flags: T;
}

export const $command = <T extends Flags>(
	opts: CreateCommand<T>,
): Command<T> => {
	return {
		...opts,
		flags: opts.flags ?? ({} as T),
	};
};

const parseFlags = <T extends Flags>(
	flags: T,
	args: string[],
): InferFlags<T> => {
	const acc: Record<string, any> = {};

	for (const [key, { when, type }] of Object.entries(flags)) {
		if (type?.default) {
			acc[key] = Value.Convert(type, type.default);
		}
		for (const matcher of when) {
			for (const arg of args) {
				const [name, value] = arg.split("=");
				if (name === matcher) {
					if (type && !value) {
						log(`ERROR: Flag ${matcher} requires a value.`);
						process.exit(1);
					}
					acc[key] = type
						? Value.Convert(type, Value.Default(type, value))
						: true;
				}
			}
		}
	}

	return acc as InferFlags<T>;
};

export const builtInFlags = {
	help: {
		when: ["-h", "--help"],
		description: "Show this help message",
	},
	verbose: {
		when: ["-v", "--verbose"],
		description: "Enable verbose output",
	},
};

/**
 * Run the given commands.
 */
export function cli(opts: {
	name: string;
	description: string;
	commands: Command<any>[];
	flags?: Flags;
}) {
	const commands = opts.commands || [];
	const flags = {
		...opts.flags,
		...builtInFlags,
	};

	const argv = process.argv;
	const args = argv.slice(2);
	const context = {
		flags: parseFlags(flags, args),
		run,
	};

	logOptions.verbose = !!context.flags.verbose;

	const command = args.find((it) => !it.startsWith("-"))?.toLowerCase();

	const action = command
		? commands.find(({ when }) => when?.includes(command))
		: commands.find(({ when }) => !when);

	if (context.flags.help) {
		if (action && command) {
			help([action], { ...action.flags, ...flags }, { name: opts.name });
			return;
		}

		help(commands, flags, opts);
		return;
	}

	if (action) {
		if (action.flags) {
			Object.assign(context.flags, parseFlags(action.flags, args));
		}

		(async () => {
			await action.handler(context);

			if (!action.skipSummary) {
				summary();
			}
		})().catch((e) => {
			console.error(e);
			process.exit(1);
		});

		return;
	}

	if (!command) {
		help(commands, flags, opts);
		return;
	}

	log(`\nUnknown command: ${command}\n`);
}

export interface RunOptions {
	alias?: string;
	parallel?: boolean;
}

export type RunCommand =
	| string
	| (RunOptions & { command: string })
	| Array<string | (RunOptions & { command: string })>;

export type Runner = (cmd: RunCommand, opts?: RunOptions) => Promise<string>;

const shxCommands = ["rm", "cp", "mv", "mkdir", "touch", "cat", "echo", "ls"];
export function isShxCommand(cmd: string) {
	for (const it of shxCommands) {
		if (cmd.startsWith(it)) {
			return true;
		}
	}
	return false;
}

/**
 * Run the given command.
 *
 * @param cmd
 * @param opts
 */
async function run(cmd: RunCommand, opts: RunOptions = {}): Promise<string> {
	if (Array.isArray(cmd)) {
		if (opts.parallel !== false) {
			await Promise.all(
				cmd.map((it) =>
					typeof it === "string" ? run(it) : run(it.command, it),
				),
			);
			return "";
		}

		for (const it of cmd) {
			await run(
				typeof it === "string" ? it : it.command,
				typeof it === "string" ? {} : it,
			);
		}
		return "";
	}

	if (typeof cmd === "object") {
		return run(cmd.command, cmd);
	}

	const name: string = opts.alias || cmd;

	log(`Starting '${name}' ...`);

	if (isShxCommand(cmd)) {
		const shxPath = join(process.cwd(), "node_modules", ".bin", "shx");
		cmd = `${shxPath} ${cmd}`;
	}

	const now = Date.now();
	let out = "";
	try {
		out = await new Promise<string>((resolve, reject) => {
			exec(cmd, (err, stdout) => {
				if (err) {
					err.stdout = stdout;
					reject(err);
				} else {
					resolve(stdout);
				}
			});
		});
		if (logOptions.verbose) {
			const lines = out
				.split("\n")
				.filter((it) => it.trim())
				.map((it) => `'${name}': ${it}`);
			for (const line of lines) {
				log(line);
			}
		}
	} catch (e) {
		if (e instanceof Error) {
			log("");
			log("ERROR -", e.message.trim());
			if ("stdout" in e) {
				console.log("");
				console.log(e.stdout?.toString());
			}
		}
		process.exit(1);
	}

	const result = {
		out,
		name,
		time: ((Date.now() - now) / 1000).toFixed(2),
	};

	timers.push(result);

	log(`Finished '${name}' after`, result.time, "s");

	return out;
}

/**
 * Log the summary of the commands.
 */
export function summary() {
	log("");
	renderTable(timers.map(({ time, name }) => [name, `${time} s`]));
	log("Total time:", ((Date.now() - now) / 1000).toFixed(2), "s\n");
}

/**
 * Render a table with the given data.
 *
 * @param data
 */
export function renderTable(data: string[][]): void {
	const col1Width = Math.max(...data.map(([col1]) => col1.length), 10);
	const col2Width = Math.max(...data.map(([, col2]) => col2.length), 10);

	const divider = `+${"-".repeat(col1Width + 2)}+${"-".repeat(col2Width + 2)}+`;
	log(divider);
	log(`| ${"Command".padEnd(col1Width)} | ${"Duration".padEnd(col2Width)} |`);
	log(divider);
	for (const [col1, col2] of data) {
		log(`| ${col1.padEnd(col1Width)} | ${col2.padEnd(col2Width)} |`);
	}
	log(divider);
}

export interface HelpOptions {
	name: string;
	description?: string;
}

export function help(
	commands: Array<Command<Flags>>,
	flags: Flags,
	opts: HelpOptions,
) {
	if (opts.description) {
		log("");
		log(opts.description);
	}

	log("");
	if (commands.length === 1) {
		log(`Usage: ${opts.name} ${commands[0].when?.join(", ") ?? ""}`);
	} else {
		log("Commands:");
		for (const { when, description } of commands) {
			log(
				`    ${opts.name} ${(when?.join(", ") ?? "").padEnd(20)} # ${description}`,
			);
		}
	}

	log("");
	log("Flags:");
	for (const { when, description } of Object.values(flags)) {
		log(
			`    ${when.join(", ").padEnd(21 + opts.name.length)} # ${description}`,
		);
	}

	log("");
}
