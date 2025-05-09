import { $command, log } from "@alepha/cli";
import { up } from "./up.ts";
import { readFile } from "node:fs/promises";
import { build } from "./build.ts";

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

		await run("yarn");
		await build.handler({run, flags});
		await up.handler({ run, flags });

		const version = await getVersion();

		await run(`git commit -am "release: ${version}"`);
		await run(`git tag -a ${version} -m "release: ${version}"`);

		log("");
		log("Release project successfully.");
		log(
			"- Run `yarn a publish` to push packages to npm registry.",
		);
		log("- Run `git push --follow-tags` to push commit to remote repository.");
		log("");
	},
})

export async function getVersion() {
	const { version } = JSON.parse(
		await readFile("packages/alepha/package.json", "utf8"),
	);
	return version;
}
