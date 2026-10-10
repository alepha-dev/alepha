// Runs `alepha compile --desktop` the way the CLI does, with the e2e's
// headless shell injected at compile time. Node, from the project root.
import { join, resolve } from "node:path";

import { Alepha } from "alepha";
import { WorkspaceCompiler } from "alepha/cli";

const root = process.cwd();
const alepha = Alepha.create({
  env: { LOG_LEVEL: "warn", NODE_ENV: "production" },
});
const binary = await alepha.inject(WorkspaceCompiler).compileDesktop({
  root,
  name: "fixture",
  config: { name: "Desktop Fixture", identifier: "dev.alepha.desktop-fixture" },
  headless: { shell: resolve(join(root, "headless-shell.js")) },
});
console.log(binary);
