import { exec } from "node:child_process";
import { cp, glob, rm } from "node:fs/promises";
import type { Logger } from "@alepha/core";
import { CommandError } from "../errors/CommandError.ts";

export type Task = {
	name: string;
	handler: () => any;
};

interface Timer {
	name: string;
	duration: string;
}

export interface RunnerMethod {
	(cmd: string | Array<string | Task>, fn?: () => any): Promise<string>;
	rm: (glob: string | string[]) => Promise<string>;
	cp: (source: string, dest: string) => Promise<string>;
}

export class Runner {
	protected readonly log: Logger;
	protected readonly timers: Timer[] = [];
	protected readonly startTime: number = Date.now();
	public readonly run: RunnerMethod;

	constructor(log: Logger) {
		this.log = log;
		this.run = this.createRunMethod();
	}

	protected createRunMethod() {
		const runFn: RunnerMethod = async (
			cmd: string | Array<string | Task>,
			fn?: () => any,
		) => {
			if (Array.isArray(cmd)) {
				return await this.execute(
					cmd.map((it) =>
						typeof it === "string"
							? { name: it, handler: () => this.exec(it) }
							: it,
					),
				);
			}

			return await this.execute({
				name: cmd,
				handler: fn ? fn : () => this.exec(cmd),
			});
		};

		runFn.rm = async (files: string | string[]): Promise<string> => {
			if (Array.isArray(files)) {
				return runFn(`rm -rf ${files.join(" ")}`, async () => {
					for await (const file of glob(files)) {
						this.log.trace(`Removing ${file}`);
						await rm(file, { recursive: true, force: true });
					}
				});
			}
			this.log.trace(`Removing ${files}`);
			return runFn(`rm -rf ${files}`, () =>
				rm(files, { recursive: true, force: true }),
			);
		};

		runFn.cp = async (source: string, dist: string): Promise<string> => {
			this.log.trace(`Copying ${source} to ${dist}`);
			return runFn(`cp -r ${source} ${dist}`, () =>
				cp(source, dist, { recursive: true }),
			);
		};

		return runFn;
	}

	protected async exec(cmd: string): Promise<string> {
		return await new Promise<string>((resolve, reject) => {
			exec(cmd, (err, stdout) => {
				if (err) {
					err.stdout = stdout;
					reject(err);
				} else {
					resolve(stdout);
				}
			});
		});
	}

	/**
	 * Executes one or more tasks.
	 *
	 * @param task - A single task or an array of tasks to run in parallel.
	 */
	protected async execute(task: Task | Task[]): Promise<string> {
		if (Array.isArray(task)) {
			await Promise.all(task.map((t) => this.executeTask(t)));
			return ""; // not supported for now
		} else {
			return await this.executeTask(task);
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

	protected async executeTask(task: Task): Promise<string> {
		this.log.info(`Starting '${task.name}' ...`);
		const now = Date.now();

		let stdout = "";

		try {
			stdout = String((await task.handler()) ?? "");
		} catch (error) {
			if (error instanceof Error && "stdout" in error) {
				this.log.info(error.stdout);
			}
			throw new CommandError(`Task '${task.name}' failed`, { cause: error });
		}

		this.log.trace(stdout);

		const duration = ((Date.now() - now) / 1000).toFixed(2);
		this.log.info(`Finished '${task.name}' after ${duration}s`);

		this.timers.push({
			name: task.name,
			duration: `${duration} s`,
		});

		return stdout;
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
