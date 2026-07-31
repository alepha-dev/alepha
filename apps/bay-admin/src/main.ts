import { Alepha, run } from "alepha";
import { oauthOptions } from "alepha/api/oauth";
import { BayAdminApi } from "./api/index.ts";
import { PulseMcp } from "./mcp/index.ts";
import { PulseWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "BAY_UI",
  },
});

// The OAuth authorization server needs to know where a human approves a device
// login, and where to send an unauthenticated one first. Set before BayAdminApi
// registers the realm.
alepha.set(oauthOptions, {
  realm: "default",
  resource: "/api",
  loginPath: "/auth/login",
  devicePath: "/device",
});

alepha.with(BayAdminApi);
alepha.with(PulseMcp);
alepha.with(PulseWeb);

run(alepha);
