import { cli } from "../packages/cli/src/index.ts";
import { clean } from "./clean.ts";
import { verify } from "./verify.ts";
import { publish } from "./publish.ts";
import { up } from "./up.ts";
import { release } from "./release.ts";
import { build } from "./build.ts";

cli({
	name: "alepha",
	description: "Manage Alepha project",
	commands: [
		clean,
		verify,
		publish,
		build,
		up,
		release
	]
})
