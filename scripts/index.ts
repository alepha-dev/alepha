import { cli } from "../packages/cli/src/index.ts";
import { clean } from "./clean.ts";
import { release } from "./release.ts";
import { verify } from "./verify.ts";

cli({
	name: "alepha",
	description: "Manage Alepha project",
	commands: [clean, verify, release],
});
