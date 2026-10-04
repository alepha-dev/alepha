import { run } from "alepha";

import { AlephaDevtoolsServer } from "./server/index.ts";
import { DevToolsApp } from "./ui/index.ts";

// `yarn dev:ui`: the UI with hot reload and the devtools server in one
// process, so the panels talk to the apps running on this machine exactly as
// `npx @alepha/devtools` does.
run([DevToolsApp, AlephaDevtoolsServer]);
