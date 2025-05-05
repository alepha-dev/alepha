import { writeFileSync } from "node:fs";
import { $command, cli } from "@alepha/cli";
import { Alepha } from "@alepha/core";
import { PostgresModule } from "@alepha/postgres";

const { DATABASE_URL, VERCEL_PROJECT_ID, VERCEL_ORG_ID } = process.env;

const migrate = $command({
	when: ["migrate", "m"],
	description: "Run alepha migrations",
	handler: async () => {
		await Alepha.create({
			env: {
				DATABASE_URL,
				DATABASE_MIGRATIONS_FOLDER: "./drizzle",
			},
		})
			.with(PostgresModule)
			.start();
	},
});

cli({
	name: "alepha-playground",
	description: "Playground for Alepha",

	commands: [
		migrate,
		$command({
			flags: {
				prod: {
					when: ["-p", "--prod"],
					description: "Deploy to production",
				},
			},
			description: "Build, migrate and deploy",
			handler: async ({ run, flags }) => {
				await run("yarn shx rm -rf dist");
				await run("yarn dist");
				await run("yarn shx mkdir -p dist/.vercel");

				writeFileSync(
					"dist/.vercel/project.json",
					JSON.stringify(
						{
							projectId: VERCEL_PROJECT_ID,
							orgId: VERCEL_ORG_ID,
							settings: {
								nodeVersion: "22.x",
								createdAt: new Date().getTime(),
								framework: null,
								devCommand: null,
								installCommand: null,
								buildCommand: null,
								outputDirectory: null,
								rootDirectory: null,
								directoryListing: false,
							},
						},
						null,
						"  ",
					),
				);

				await run("yarn deploy migrate");

				const out = await run(
					`cd dist && yarn vercel deploy ${flags.prod ? "--prod" : ""}`,
				);

				console.log("");
				console.log("->", out);
			},
		}),
	],
});
