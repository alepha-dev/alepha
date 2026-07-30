import { Alepha, run } from "alepha";
import { oauthOptions } from "alepha/api/oauth";
import { BayUiApi } from "./api/index.ts";
import { BayUiWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "BAY_UI",
  },
});

// The OAuth authorization server needs to know where a human approves a device
// login, and where to send an unauthenticated one first. Set before BayUiApi
// registers the realm.
alepha.set(oauthOptions, {
  realm: "default",
  resource: "/api",
  loginPath: "/auth/login",
  devicePath: "/device",
});

alepha.with(BayUiApi);
alepha.with(BayUiWeb);

run(alepha);
