import { $command } from "../packages/cli/src/index.ts";
import { up } from "./up.ts";
import { readFile } from "node:fs/promises";
import { verify } from "./verify.ts";

export const release = $command({
	when: ["release"],
	description: "Release packages version (default: minor)",
	flags: {
		...up.flags,
	},
	handler: async ({ run, flags }) => {
		const diff = await run("git diff");
		if (!!diff) {
			console.log("Error - You must commit file(s) before running the release script.");
			return;
		}

		await verify.handler({ run, flags });
		await up.handler({ run, flags });

		const version = await getVersion();

		await run(`git commit -am "release: ${version}"`);
		await run(`git tag -a ${version} -m "release: ${version}"`);

		console.log("");
		console.log("Release project successfully.");
		console.log(
			"- Run `yarn alepha publish` to push packages to npm registry.",
		);
		console.log("- Run `git push --follow-tags` to push commit to remote repository.");
		console.log("");
	},
})

export async function getVersion() {
	const { version } = JSON.parse(
		await readFile("packages/alepha/package.json", "utf8"),
	);
	return version;
}
