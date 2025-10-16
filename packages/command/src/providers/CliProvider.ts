import * as fs from "node:fs/promises";
import { glob } from "node:fs/promises";
import {
	$env,
	$hook,
	$inject,
	Alepha,
	type Static,
	type TObject,
	type TSchema,
	TypeBoxError,
	t,
} from "@alepha/core";
import { $logger } from "@alepha/logger";
import {
	$command,
	type CommandDescriptor,
	type CommandHandlerArgs,
} from "../descriptors/$command.ts";
import { CommandError } from "../errors/CommandError.ts";
import { Asker } from "../helpers/Asker.ts";
import { Runner } from "../helpers/Runner.ts";

const envSchema = t.object({
	CLI_NAME: t.text({
		default: "cli",
		description: "Name of the CLI application.",
	}),
	CLI_DESCRIPTION: t.text({
		default: "",
		description: "Description of the CLI application.",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class CliProvider {
	protected readonly env = $env(envSchema);
	protected readonly alepha = $inject(Alepha);
	protected readonly log = $logger();
	protected readonly runner = $inject(Runner);
	protected readonly asker = $inject(Asker);

	public options = {
		name: this.env.CLI_NAME,
		description: this.env.CLI_DESCRIPTION,
		argv: typeof process !== "undefined" ? process.argv.slice(2) : [],
	};

	protected readonly globalFlags = {
		help: {
			aliases: ["h", "help"],
			description: "Show this help message",
			schema: t.boolean(),
		},
	};

	protected readonly onReady = $hook({
		on: "ready",
		handler: async () => {
			const argv = [...this.options.argv];
			const commandName = argv.find((arg) => !arg.startsWith("-")) ?? "";
			const command = this.findCommand(commandName);

			const globalFlags = this.parseFlags(
				argv,
				Object.entries(this.globalFlags).map(([key, value]) => ({
					key,
					...value,
				})),
			);

			if (globalFlags.help) {
				this.printHelp(command);
				return;
			}

			if (!command) {
				if (commandName !== "") {
					this.log.error(`Unknown command: '${commandName}'`);
					this.printHelp();
				}
				return;
			}

			const commandFlags = this.parseCommandFlags(argv, command.flags);
			const commandArgs = this.parseCommandArgs(argv, command.options.args);

			await this.alepha.context.run(async () => {
				this.log.debug(`Executing command '${command.name}'...`, {
					flags: commandFlags,
					args: commandArgs,
				});

				const runner = this.runner;

				const args = {
					flags: commandFlags,
					args: commandArgs,
					run: runner.run,
					ask: this.asker.ask,
					fs,
					glob,
				};

				await command.options.handler(args as CommandHandlerArgs<TObject>);

				if (command.options.summary !== false) {
					runner.summary();
				}

				this.log.debug(`Command '${command.name}' executed successfully.`);
			});
		},
	});

	public get commands(): CommandDescriptor<any>[] {
		return this.alepha.descriptors($command);
	}

	private findCommand(name: string): CommandDescriptor<TObject> | undefined {
		return this.commands.find(
			(command) => command.name === name || command.aliases.includes(name),
		);
	}

	protected parseCommandFlags(
		argv: string[],
		schema: TObject,
	): Record<string, any> {
		const flagDefs = Object.entries(schema.properties).map(([key, value]) => ({
			key,
			aliases: [key, ...((value as any).aliases ?? (value as any).alias ?? [])],
			description: (value as any).description,
			schema: value,
		}));

		const parsed = this.parseFlags(argv, flagDefs);

		try {
			return this.alepha.parse(schema, parsed);
		} catch (error) {
			if (error instanceof TypeBoxError) {
				throw new CommandError(
					`Invalid flag: ${error.cause.instancePath} - ${error.cause.message}`,
				);
			}
			throw error;
		}
	}

	protected parseFlags(
		argv: string[],
		flagDefs: { key: string; aliases: string[]; schema: TSchema }[],
	): Record<string, any> {
		const result: Record<string, any> = {};

		for (const arg of argv.filter((a) => a.startsWith("-"))) {
			const [rawKey, ...valueParts] = arg.replace(/^-{1,2}/, "").split("=");
			const value = valueParts.join("=");

			const def = flagDefs.find((d) => d.aliases.includes(rawKey));
			if (!def) continue;

			if (t.schema.isBoolean(def.schema)) {
				result[def.key] = true;
			} else if (value) {
				try {
					if (t.schema.isObject(def.schema) || t.schema.isArray(def.schema)) {
						result[def.key] = JSON.parse(value);
					} else {
						result[def.key] = value;
					}
				} catch {
					throw new CommandError(`Invalid JSON value for flag --${rawKey}`);
				}
			} else {
				throw new CommandError(`Flag --${rawKey} requires a value.`);
			}
		}

		return result;
	}

	protected parseCommandArgs(argv: string[], schema?: TSchema): any {
		if (!schema) {
			return undefined;
		}

		// Extract positional arguments (non-flag arguments)
		const positionalArgs = argv.filter((arg) => !arg.startsWith("-"));
		// Remove the command name from the positional args
		const argsOnly = positionalArgs.slice(1);

		try {
			if (t.schema.isOptional(schema)) {
				// Handle optional args: t.optional(t.text())
				if (argsOnly.length === 0) {
					return undefined;
				}
				return this.parseArgumentValue(argsOnly[0], schema);
			} else if (t.schema.isTuple(schema) && schema.items) {
				// Handle tuple args: t.tuple([t.text(), t.number()])
				const result: any[] = [];
				const items = schema.items;
				for (let i = 0; i < items.length; i++) {
					const itemSchema = items[i];
					if (i < argsOnly.length) {
						result.push(this.parseArgumentValue(argsOnly[i], itemSchema));
					} else if (t.schema.isOptional(itemSchema)) {
						result.push(undefined);
					} else {
						throw new CommandError(
							`Missing required argument at position ${i + 1}`,
						);
					}
				}
				return result;
			} else {
				// Handle single arg: t.text(), t.number(), etc.
				if (argsOnly.length === 0) {
					throw new CommandError("Missing required argument");
				}
				return this.parseArgumentValue(argsOnly[0], schema);
			}
		} catch (error) {
			if (error instanceof TypeBoxError) {
				throw new CommandError(`Invalid argument: ${error.value.message}`);
			}
			throw error;
		}
	}

	protected parseArgumentValue(value: string, schema: TSchema): any {
		if (t.schema.isString(schema)) {
			return value;
		}

		if (t.schema.isNumber(schema) || t.schema.isInteger(schema)) {
			const num = Number(value);
			if (Number.isNaN(num)) {
				throw new CommandError(`Expected number, got "${value}"`);
			}
			if (t.schema.isInteger(schema) && !Number.isInteger(num)) {
				throw new CommandError(`Expected integer, got "${value}"`);
			}
			return num;
		}

		if (t.schema.isBoolean(schema)) {
			const lower = value.toLowerCase();
			if (lower === "true" || lower === "1") return true;
			if (lower === "false" || lower === "0") return false;
			throw new CommandError(`Expected boolean, got "${value}"`);
		}

		// For other types, return the string value and let TypeBox validate it
		return value;
	}

	protected generateArgsUsage(schema?: TSchema): string {
		if (!schema) {
			return "";
		}

		if (t.schema.isOptional(schema)) {
			const typeName = this.getTypeName(schema);
			const key = "title" in schema ? (schema as any).title : "arg1";
			return ` [${key}${typeName}]`;
		}

		if (t.schema.isTuple(schema) && schema.items) {
			const items = schema.items;
			const args = items.map((item, index) => {
				const argName = `arg${index + 1}`;
				const typeName = this.getTypeName(item);
				if (t.schema.isOptional(item)) {
					return `[${argName}${typeName}]`;
				}
				return `<${argName}${typeName}>`;
			});
			return ` ${args.join(" ")}`;
		}

		const typeName = this.getTypeName(schema);
		const key = "title" in schema ? (schema as any).title : "arg1";
		return ` <${key}${typeName}>`;
	}

	protected getTypeName(schema: TSchema): string {
		if (!schema) return "";

		// Check TypeBox type guards first
		if (t.schema.isString(schema)) return "";
		if (t.schema.isNumber(schema)) return ": number";
		if (t.schema.isInteger(schema)) return ": integer";
		if (t.schema.isBoolean(schema)) return ": boolean";

		return "";
	}

	public printHelp(command?: CommandDescriptor<any>): void {
		const cliName = this.options.name || "cli";
		this.log.info(""); // Newline

		if (command?.name) {
			// Command-specific help
			const argsUsage = this.generateArgsUsage(command.options.args);
			const usage = `${cliName} ${command.name}${argsUsage}`.trim();
			this.log.info(`Usage: \`${usage}\``);

			if (command.options.description) {
				this.log.info(``);
				this.log.info(`\t${command.options.description}`);
			}

			this.log.info("");
			this.log.info("Flags:");

			const flags = [
				...Object.entries(command.flags.properties).map(([key, value]) => ({
					key,
					schema: value,
					aliases: (value as any).alias ?? [key],
					description: (value as any).description,
				})),
				...Object.entries(this.globalFlags).map(([key, value]) => ({
					key,
					...value,
				})),
			];

			const maxFlagLength = this.getMaxFlagLength(flags);
			for (const { aliases, description } of flags) {
				const flagStr = aliases
					.map((a: string) => (a.length === 1 ? `-${a}` : `--${a}`))
					.join(", ");
				this.log.info(
					`    ${flagStr.padEnd(maxFlagLength)} # ${description ?? ""}`,
				);
			}
		} else {
			// general help
			this.log.info(this.options.description || "Available commands:");
			this.log.info("");
			this.log.info("Commands:");
			const maxCmdLength = this.getMaxCmdLength(this.commands);

			for (const command of this.commands) {
				// skip root command in list
				if (command.name === "") {
					continue;
				}

				const cmdStr = [command.name, ...command.aliases].join(", ");
				const argsUsage = this.generateArgsUsage(command.options.args);
				const fullCmdStr = `${cmdStr}${argsUsage}`;
				this.log.info(
					`    ${cliName} ${fullCmdStr.padEnd(maxCmdLength)} # ${command.options.description ?? ""}`,
				);
			}

			this.log.info("");
			this.log.info("Flags:");
			const globalFlags = Object.values(this.globalFlags);
			const maxFlagLength = this.getMaxFlagLength(globalFlags);
			for (const { aliases, description } of globalFlags) {
				const flagStr = aliases
					.map((a) => (a.length === 1 ? `-${a}` : `--${a}`))
					.join(", ");
				this.log.info(
					`    ${flagStr.padEnd(maxFlagLength)} # ${description ?? ""}`,
				);
			}
		}
		this.log.info(""); // Newline
	}

	private getMaxCmdLength(commands: CommandDescriptor[]): number {
		return Math.max(
			...commands.map((c) => {
				const cmdStr = [c.name, ...c.aliases].join(", ");
				const argsUsage = this.generateArgsUsage(c.options.args);
				return `${cmdStr}${argsUsage}`.length;
			}),
		);
	}

	private getMaxFlagLength(flags: { aliases: string[] }[]): number {
		return Math.max(
			...flags.map(
				(f) =>
					f.aliases.map((a) => (a.length === 1 ? `-${a}` : `--${a}`)).join(", ")
						.length,
			),
		);
	}
}
