import { Alepha, run } from "alepha";
import { oauthOptions } from "alepha/api/oauth";
import { bodyParserOptions, multipartOptions } from "alepha/server";
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

/*
Artifact uploads are the whole job, and the defaults forbid them.

`alepha pack` produces tens of megabytes for any app with assets — lindocara's
is 32 MB — against a 5 MB per-file multipart cap and a 100 KB plain-body cap.
Both refuse with a 413, which HTTP/2 then surfaces to the CLI as
`NGHTTP2_ENHANCE_YOUR_CALM`: a stream reset that says nothing about size.

100 MB, not more, because the upload is BUFFERED — the multipart parser holds
it, and `BayControlService` takes an `arrayBuffer()` copy to forward it to
Bay's socket. Two copies of a 100 MB artifact plus the app's own footprint
still fits under the 512 MB Bay caps this app at; 200 would not, and the
failure would be an OOM kill of the panel mid-deploy rather than a clean
refusal.

`fileCount: 1` because a deploy is one artifact. Anything else is a mistake or
an attempt.
*/
const MAX_ARTIFACT_BYTES = 100_000_000;
alepha.set(multipartOptions, {
  limit: MAX_ARTIFACT_BYTES,
  fileLimit: MAX_ARTIFACT_BYTES,
  fileCount: 1,
});
alepha.set(bodyParserOptions, {
  inflate: true,
  limit: MAX_ARTIFACT_BYTES,
});

alepha.with(BayAdminApi);
alepha.with(PulseMcp);
alepha.with(PulseWeb);

run(alepha);
