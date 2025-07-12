import type { Logger } from "@alepha/core";
import { $ } from "zx";
import type { ProcessPromise } from "zx/core";
import { CommandError } from "../errors/CommandError.ts";

export interface ShTask {
	type: "sh";
	handler: ProcessPromise;
	name: string;
}

export interface FnTask {
	type: "fn";
	handler: () => any;
	name: string;
}

export type Task = ShTask | FnTask;

export const sh = (pieces: TemplateStringsArray, ...args: any[]): ShTask => {
	const command = $(pieces, ...args);
	return {
		type: "sh",
		handler: command,
		name: (command as any)._command,
	};
};

export const fn = (name: string, handler: () => any): FnTask => {
	return {
		type: "fn",
		name,
		handler,
	};
};

interface Timer {
	name: string;
	duration: string;
}

export interface RunnerMethod {
	(task: Task | Task[]): Promise<void>;
	sh: (pieces: TemplateStringsArray, ...args: any[]) => Promise<void>;
	fn: (name: string, handler: () => any) => Promise<void>;
}

export class Runner {
	protected readonly log: Logger;
	protected readonly timers: Timer[] = [];
	protected readonly startTime: number = Date.now();
	public readonly run: RunnerMethod;

	constructor(log: Logger) {
		this.log = log;

		const runFn: any = (task: Task | Task[]) => this.execute(task);

		runFn.sh = (
			pieces: TemplateStringsArray,
			...args: any[]
		): Promise<void> => {
			const command = $(pieces, ...args);
			return this.execute({
				type: "sh",
				handler: command,
				name: (command as any)._command,
			});
		};

		runFn.fn = (name: string, handler: () => any): Promise<void> => {
			return this.execute({
				type: "fn",
				name,
				handler,
			});
		};

		this.run = runFn;
	}

	/**
	 * Executes one or more tasks.
	 *
	 * @param task - A single task or an array of tasks to run in parallel.
	 */
	protected async execute(task: Task | Task[]): Promise<void> {
		if (Array.isArray(task)) {
			await Promise.all(task.map((t) => this.executeTask(t)));
		} else {
			await this.executeTask(task);
		}
	}

	/**
	 * Prints a summary of all executed tasks and their durations.
	 */
	public summary(): void {
		this.log.info("");
		this.renderTable(this.timers.map((t) => [t.name, t.duration]));
		const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(2);
		this.log.info(`Total time: ${totalTime} s`);
		this.log.info(``);
	}

	protected async executeTask(task: Task): Promise<void> {
		this.log.info(`Starting '${task.name}' ...`);
		const now = Date.now();

		try {
			// Await the handler, which is either a zx ProcessPromise or a user function.
			if (typeof task.handler === "function") {
				await task.handler();
			} else {
				await task.handler;
			}
		} catch (error) {
			throw new CommandError(`Command '${task.name}' failed`, { cause: error });
		}

		const duration = ((Date.now() - now) / 1000).toFixed(2);
		this.log.info(`Finished '${task.name}' after ${duration}s`);

		this.timers.push({
			name: task.name,
			duration: `${duration} s`,
		});
	}

	protected renderTable(data: string[][]): void {
		if (data.length === 0) return;

		const col1Width = Math.max(...data.map(([col1]) => col1.length), 7);
		const col2Width = Math.max(...data.map(([, col2]) => col2.length), 8);

		const divider = `+${"-".repeat(col1Width + 2)}+${"-".repeat(
			col2Width + 2,
		)}+`;
		this.log.info(divider);
		this.log.info(
			`| ${"Command".padEnd(col1Width)} | ${"Duration".padEnd(col2Width)} |`,
		);
		this.log.info(divider);
		for (const [col1, col2] of data) {
			this.log.info(
				`| ${col1.padEnd(col1Width)} | ${col2.padEnd(col2Width)} |`,
			);
		}
		this.log.info(divider);
	}
}
