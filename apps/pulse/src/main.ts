import { Alepha, run } from "alepha";
import { PulseApi } from "./api/index.ts";
import { PulseWeb } from "./web/index.ts";

/**
 * ⚠️ Pulse is not finished. This boots the server half that moved out of
 * bay-admin; it has no web UI of its own yet and no way to create the first
 * account. See `TODO.md`.
 */
const alepha = Alepha.create({
  env: {
    APP_NAME: "PULSE",
  },
});

alepha.with(PulseApi);
// alepha.with(PulseMcp);
alepha.with(PulseWeb);

run(alepha);
