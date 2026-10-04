import { $module } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaOrm } from "alepha/orm";
import { AlephaServerCors } from "alepha/server/cors";

import { HelloController } from "./controllers/HelloController.ts";
import { NoteController } from "./controllers/NoteController.ts";
import { Realm } from "./Realm.ts";
import { ApiStallSwitch } from "./services/ApiStallSwitch.ts";
import { CorsPolicy } from "./services/CorsPolicy.ts";
import { TestUserSeed } from "./services/TestUserSeed.ts";

/**
 * The API the native shell talks to across origins: password login through
 * the realm, an unprotected greeting the first screen loads, and the signed-in
 * user's notes. CORS admits the WebView origins (see `CorsPolicy`).
 *
 * AlephaOrm needs DATABASE_URL; in development DATABASE_SYNC defaults to
 * true, so the schema is pushed for you. Freeze it before a build with
 * `yarn w mobile db:generate`.
 */
export const ApiModule = $module({
  name: "mobile.api",
  imports: [AlephaOrm, AlephaApiUsers, AlephaServerCors],
  services: [
    Realm,
    HelloController,
    NoteController,
    TestUserSeed,
    ApiStallSwitch,
    CorsPolicy,
  ],
});
