import { $command, log } from "@alepha/cli";
import { up } from "./up.ts";
import { build } from "./build.ts";
import { readFile } from "node:fs/promises";
import { publish } from "./publish.ts";

export const release = $command({
	when: ["release"],
	description: "Release packages version (default: minor)",
	flags: {
		...up.flags,
	},
	handler: async ({ run, flags }) => {
		const diff = await run("git diff");
		if (!!diff) {
			log("Error - You must commit file(s) before running the release script.");
			return;
		}

		await run("yarn format");
		await run("yarn lint");
		await run("yarn check");
		await run("yarn test");

		await up.handler({ run, flags });

		await run("yarn a build");
		await run("yarn convert ts");

		const version = await getVersion();

		await run(`git commit -am "release: ${version}"`);
		await run(`git tag -a ${version} -m "release: ${version}"`);

		log("");
		log("Release project successfully.");
		log("- Run `git push --follow-tags` to push commit to remote repository.");
		log(
			"- Run `yarn a publish` to push packages to npm registry.",
		);
		log("");
	},
})

export async function getVersion() {
	const { version } = JSON.parse(
		await readFile("packages/alepha/package.json", "utf8"),
	);
	return version;
}
