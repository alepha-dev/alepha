import { Alepha, run } from "alepha";

import { LoomApi } from "./api/index.ts";
import { LoomWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "LOOM",
    // Loom runs as a login item, on a machine where 3000 is every framework's
    // default. 27483 is unregistered in /etc/services, outside every band
    // this repo reserves, and below both the macOS (49152+) and Linux (32768+)
    // ephemeral ranges. An explicit SERVER_PORT still wins, and `alepha dev`
    // sets one (3312, `dev.port`) before this runs.
    SERVER_PORT: Number(process.env.SERVER_PORT || 27483),
    // The UI modules keep preferences in cookies, and the cookie module holds
    // a signing key, so the binary refuses to boot on the public default.
    // Nobody should have to invent one for a local tool: Loom generates its
    // own on first boot and keeps it beside the binary, mode 0600. An
    // explicit APP_SECRET still wins.
    APP_SECRET_FILE:
      process.env.APP_SECRET_FILE ||
      `${process.env.LOOM_HOME || `${process.env.HOME}/.alepha/apps/loom`}/secret`,
  },
});

alepha.with(LoomApi);
alepha.with(LoomWeb);

run(alepha);
