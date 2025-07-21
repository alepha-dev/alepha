import { Alepha, MockLogger, t } from "@alepha/core";
import { describe, expect, test, vi } from "vitest";
import { $command, CliProvider } from "../src";

describe("$command", () => {
	const setupTestCommands = async (
		argv?: string[],
		before?: (alepha: Alepha) => any,
	) => {
		const mockHandlers = {
			greet: vi.fn(),
			root: vi.fn(),
			deploy: vi.fn(),
		};

		class TestCommands {
			greet = $command({
				description: "A simple greeting command.",
				aliases: ["g"],
				flags: t.object({
					name: t.string({ description: "Name to greet." }),
					times: t.optional(t.int({ default: 1 })),
				}),
				handler: mockHandlers.greet,
			});

			deploy = $command({
				description: "Deploys the application.",
				flags: t.object({
					production: t.optional(
						t.boolean({ description: "Deploy to production." }),
					),
					"api-key": t.string({
						description: "API key for deployment.",
						alias: ["key"],
					}),
				}),
				handler: mockHandlers.deploy,
			});
		}

		const mockLogger = new MockLogger();
		const alepha = Alepha.create({ log: mockLogger }).with(TestCommands);
		const provider = alepha.get(CliProvider);

		if (argv) {
			provider.options.argv = argv;
		}

		await before?.(alepha);
		await alepha.start();

		return {
			alepha,
			mockHandlers,
			provider,
			mockLogger,
		};
	};

	describe("Command Execution", () => {
		test("should execute a matched command with correct flags", async () => {
			const { mockHandlers } = await setupTestCommands([
				"greet",
				"--name=Alepha",
			]);

			expect(mockHandlers.greet).toHaveBeenCalledOnce();
			const [callArgs] = mockHandlers.greet.mock.calls[0];
			expect(callArgs.flags).toEqual({ name: "Alepha", times: 1 });
			expect(callArgs.run).toBeDefined();
		});

		test("should execute a command using its alias", async () => {
			const { mockHandlers } = await setupTestCommands(["g", "--name=World"]);

			expect(mockHandlers.greet).toHaveBeenCalledOnce();
			expect(mockHandlers.greet.mock.calls[0][0].flags.name).toBe("World");
		});

		test("should execute the root command when no command name is provided", async () => {
			const mockHandlers = {
				root: vi.fn(),
			};

			await setupTestCommands([], (a) => {
				a.with(
					class Ext {
						root = $command({
							name: "", // root command has an empty name
							description: "Root command",
							handler: mockHandlers.root,
						});
					},
				);
			});

			expect(mockHandlers.root).toHaveBeenCalledOnce();
		});

		test("should not execute any command if no matching command and no root command", async () => {
			const { mockHandlers } = await setupTestCommands(["--some-flag"]);

			expect(mockHandlers.greet).not.toHaveBeenCalled();
			expect(mockHandlers.deploy).not.toHaveBeenCalled();
		});
	});

	describe("Flag Parsing", () => {
		test("should parse string and boolean flags", async () => {
			const { mockHandlers } = await setupTestCommands([
				"deploy",
				"--production",
				"--api-key=xyz-123",
			]);

			expect(mockHandlers.deploy).toHaveBeenCalledOnce();
			expect(mockHandlers.deploy.mock.calls[0][0].flags).toEqual({
				production: true,
				"api-key": "xyz-123",
			});
		});

		test("should use flag aliases", async () => {
			const { mockHandlers } = await setupTestCommands([
				"deploy",
				"--key=abc-456",
			]);

			expect(mockHandlers.deploy).toHaveBeenCalledOnce();
			expect(mockHandlers.deploy.mock.calls[0][0].flags).toEqual({
				"api-key": "abc-456",
			});
		});

		test("should apply default values for optional flags", async () => {
			const { mockHandlers } = await setupTestCommands([
				"greet",
				"--name=Tester",
			]);
			expect(mockHandlers.greet).toHaveBeenCalledOnce();
			expect(mockHandlers.greet.mock.calls[0][0].flags).toEqual({
				name: "Tester",
				times: 1,
			});
		});

		test("should correctly parse and cast integer flags", async () => {
			const { mockHandlers, provider } = await setupTestCommands([
				"greet",
				"--name=Tester",
				"--times=5",
			]);

			expect(mockHandlers.greet).toHaveBeenCalledOnce();
			expect(mockHandlers.greet.mock.calls[0][0].flags.times).toBe(5);
		});
	});

	describe("Error Handling", () => {
		test("should log an error for an unknown command", async () => {
			const { mockLogger } = await setupTestCommands(["non-existent-command"]);

			const errorLog = mockLogger.store.stack.find((l) => l.level === "error");
			expect(errorLog).toBeDefined();
			expect(errorLog?.message).toBe("Unknown command: 'non-existent-command'");
			// It should also print help
			expect(
				mockLogger.store.stack.some((l) => l.message === "Commands:"),
			).toBe(true);
		});

		test("should throw a CommandError for missing flag values", async () => {
			await expect(() =>
				setupTestCommands(["greet", "--name"]),
			).rejects.toThrow("Flag --name requires a value");
		});

		test("should throw a CommandError for invalid flag types", async () => {
			await expect(() =>
				setupTestCommands(["greet", "--name=Test", "--times=not-a-number"]),
			).rejects.toThrow("Invalid flag: /times - Expected integer");
		});
	});

	describe("Help Message", () => {
		test("should print general help with --help flag", async () => {
			const { mockLogger } = await setupTestCommands(["--help"], (alepha) => {
				const provider = alepha.get(CliProvider);
				provider.options.name = "my-cli";
				provider.options.description = "My awesome CLI tool.";
			});

			const output = mockLogger.store.stack.map((l) => l.message).join("\n");
			expect(output).toContain("My awesome CLI tool.");
			expect(output).toContain("Commands:");
			expect(output).toContain("my-cli greet, g");
			expect(output).toContain("my-cli deploy");
			expect(output).toContain("Flags:");
			expect(output).toContain("-h, --help");
		});

		test("should print command-specific help", async () => {
			const { mockLogger } = await setupTestCommands(
				["greet", "-h"],
				(alepha) =>
					alepha.configure(CliProvider, {
						name: "my-cli",
					}),
			);

			const output = mockLogger.store.stack.map((l) => l.message).join("\n");
			expect(output).toContain("Usage: `my-cli greet`");
			expect(output).toContain("A simple greeting command.");
			expect(output).toContain("Flags:");
			expect(output).toContain("--name");
			expect(output).toContain("--times");
			expect(output).toContain("-h, --help");
		});
	});
});
