import {
	$hook,
	$inject,
	$logger,
	Alepha,
	type HookDescriptor,
	type Logger,
	OPTIONS,
	type Static,
	type TObject,
	type TProperties,
	type TSchema,
	type TString,
	TypeBoxError,
	TypeGuard,
	t,
} from "@alepha/core";
import { $command } from "../descriptors/$command.ts";
import { CommandError } from "../errors/CommandError.ts";
import { Runner } from "../helpers/Runner.ts";

interface Command {
	key: string;
	name: string;
	description?: string;
	aliases: string[];
	flags: TObject<TProperties>;
	handler: (flags: any) => Promise<void>;
}

const envSchema: TObject<{
	CLI_NAME: TString;
	CLI_DESCRIPTION: TString;
}> = t.object({
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

export class CommandDescriptorProvider {
	protected readonly env: Static<typeof envSchema> = $inject(envSchema);
	protected readonly alepha: Alepha = $inject(Alepha);
	protected readonly log: Logger = $logger();
	protected commands: Command[] = [];

	public options: {
		name: string;
		description: string;
		argv: string[];
	} = {
		name: this.env.CLI_NAME,
		description: this.env.CLI_DESCRIPTION,
		argv: typeof process !== "undefined" ? process.argv.slice(2) : [],
	};

	protected readonly globalFlags: Record<
		string,
		{ aliases: string[]; description: string; schema: TSchema }
	> = {
		help: {
			aliases: ["h", "help"],
			description: "Show this help message",
			schema: t.boolean(),
		},
	} as const;

	protected readonly onConfigure: HookDescriptor<"configure"> = $hook({
		on: "configure",
		handler: () => {
			const descriptors = this.alepha.getDescriptorValues($command);

			for (const { value, key } of descriptors) {
				const options = value[OPTIONS];
				this.commands.push({
					key,
					name: options.name ?? key,
					description: options.description,
					aliases: options.aliases ?? [],
					flags: options.flags ?? t.object({}),
					handler: options.handler as (flags: any) => Promise<void>,
				});
			}
		},
	});

	protected readonly onReady: HookDescriptor<"ready"> = $hook({
		on: "ready",
		handler: async () => {
			const argv = [...this.options.argv];
			const commandName = argv.find((arg) => !arg.startsWith("-")) ?? "";
			const command = this.findCommand(commandName);

			const globalFlags = this.parseFlags(
				argv,
				Object.keys(this.globalFlags).map((key) => ({
					key,
					...this.globalFlags[key],
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

				await command.handler(args);

				runner.summary();

				this.log.debug(`Command '${command.name}' executed successfully.`);
			});
		},
	});

	private findCommand(name: string): Command | undefined {
		return this.commands.find(
			(cmd) => cmd.name === name || cmd.aliases.includes(name),
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

	private printHelp(command?: Command): void {
		const cliName = this.options.name || "cli";
		this.log.info(""); // Newline

		if (command) {
			// Command-specific help
			this.log.info(`Usage: \`${(`${cliName} ${command.name}`).trim()}\``);

			if (command.description) {
				this.log.info(``);
				this.log.info(`\t${command.description}`);
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

			for (const { name, aliases, description } of this.commands) {
				// skip root command in list
				if (name === "") {
					continue;
				}

				const cmdStr = [name, ...aliases].join(", ");
				this.log.info(
					`    ${cliName} ${cmdStr.padEnd(maxCmdLength)} # ${description ?? ""}`,
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

	private getMaxCmdLength(commands: Command[]): number {
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
