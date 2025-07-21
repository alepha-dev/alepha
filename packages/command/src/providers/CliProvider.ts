import {
	$env,
	$hook,
	$inject,
	$logger,
	Alepha,
	type Logger,
	type Static,
	type TObject,
	type TSchema,
	TypeBoxError,
	TypeGuard,
	t,
} from "@alepha/core";
import {
	$command,
	type CommandDescriptor,
	type CommandHandlerArgs,
} from "../descriptors/$command.ts";
import { CommandError } from "../errors/CommandError.ts";
import { Runner } from "../helpers/Runner.ts";

const envSchema = t.object({
	CLI_NAME: t.string({
		default: "cli",
		description: "Name of the CLI application.",
	}),
	CLI_DESCRIPTION: t.string({
		default: "",
		description: "Description of the CLI application.",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class CliProvider {
	protected readonly env: Static<typeof envSchema> = $env(envSchema);
	protected readonly alepha = $inject(Alepha);
	protected readonly log: Logger = $logger();

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

			await this.alepha.context.run(async () => {
				this.log.debug(`Executing command '${command.name}'...`, {
					flags: commandFlags,
				});

				const runner = new Runner(this.log);

				const args = {
					flags: commandFlags,
					run: runner.run,
				};

				await command.options.handler(args as CommandHandlerArgs<TObject>);

				runner.summary();

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
					`Invalid flag: ${error.value.path} - ${error.value.message}`,
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

			if (TypeGuard.IsBoolean(def.schema)) {
				result[def.key] = true;
			} else if (value) {
				try {
					if (TypeGuard.IsObject(def.schema) || TypeGuard.IsArray(def.schema)) {
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

	private printHelp(command?: CommandDescriptor<any>): void {
		const cliName = this.options.name || "cli";
		this.log.info(""); // Newline

		if (command) {
			// Command-specific help
			this.log.info(`Usage: \`${(`${cliName} ${command.name}`).trim()}\``);

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

			for (const { name, aliases, options } of this.commands) {
				// skip root command in list
				if (name === "") {
					continue;
				}

				const cmdStr = [name, ...aliases].join(", ");
				this.log.info(
					`    ${cliName} ${cmdStr.padEnd(maxCmdLength)} # ${options.description ?? ""}`,
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
			...commands.map((c) => [c.name, ...c.aliases].join(", ").length),
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
