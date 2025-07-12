import { readdir } from "node:fs/promises";
import { $command, CommandDescriptorProvider } from "@alepha/command";
import { Alepha, run } from "@alepha/core";

class AlephaDevCli {
	clean = $command({
		description: "Will remove all generated files.",
		handler: async ({ run }) => {
			await run.sh`yarn convert ts`;

			const p = "packages";
			await run.sh`rm -rf coverage`;
			await run.sh`rm -rf ${p}/**/dist ${p}/**/node_modules ${p}/**/coverage`;

			const a = `${p}/alepha`;
			await run.sh`rm -rf ${a}/*.js ${a}/*.cjs ${a}/*.d.ts ${a}/*.map`;
			await run.sh`rm -rf ${a}/**/*.js ${a}/**/*.cjs ${a}/**/*.d.ts ${a}/**/*.map`;

			const dirs = (await readdir(a, { withFileTypes: true }))
				.filter((d) => d.isDirectory())
				.map((d) => `${a}/${d.name}`);

			if (dirs.length) {
				await run.sh`rm -rf ${dirs.join(" ")}`;
			}

			await run.sh`yarn`;
		},
	});

	verify = $command({
		aliases: ["v"],
		description: "Run linter, checker and tests.",
		handler: async ({ run, sh }) => {
			await run.sh`yarn clean`;
			await run.sh`yarn lint`;
			await run([sh`yarn check`, sh`yarn check-dependencies`]);
			await run([sh`yarn test`, sh`yarn build`]);
			await run.sh`yarn clean`;
		},
	});
}

const alepha = Alepha.create({
	env: {
		LOG_FORMAT: "cli",
		LOG_LEVEL: "alepha.command:info,warn",
	},
})
	.with(AlephaDevCli)
	.configure(CommandDescriptorProvider, {
		name: "alepha",
		description: "Alepha development CLI - manage Alepha project",
	});

run(alepha);
