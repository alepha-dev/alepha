import { $module } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaOrm } from "alepha/orm";

import { HelloController } from "./controllers/HelloController.ts";
import { NoteController } from "./controllers/NoteController.ts";
import { Realm } from "./Realm.ts";
import { ApiStallSwitch } from "./services/ApiStallSwitch.ts";
import { TestUserSeed } from "./services/TestUserSeed.ts";

/**
 * The API the native shell talks to across origins: password login through
 * the realm, an unprotected greeting the first screen loads, and the signed-in
 * user's notes.
 *
 * AlephaOrm needs DATABASE_URL; in development DATABASE_SYNC defaults to
 * true, so the schema is pushed for you. Freeze it before a build with
 * `yarn w mobile db:generate`.
 */
export const ApiModule = $module({
  name: "mobile.api",
  imports: [AlephaOrm, AlephaApiUsers],
  services: [
    Realm,
    HelloController,
    NoteController,
    TestUserSeed,
    ApiStallSwitch,
  ],
});
