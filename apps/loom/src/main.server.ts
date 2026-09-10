import { Alepha, run } from "alepha";

import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create({
  env: {
    // Loom runs as a login item, on a machine where 3000 is every framework's
    // default. 27483 is unregistered in /etc/services, outside every band
    // this repo reserves, and below both the macOS (49152+) and Linux (32768+)
    // ephemeral ranges. An explicit SERVER_PORT still wins, and `alepha dev`
    // sets one (3312, `dev.port`) before this runs.
    SERVER_PORT: Number(process.env.SERVER_PORT || 27483),
  },
});

alepha.with(AppRouter);

run(alepha);
