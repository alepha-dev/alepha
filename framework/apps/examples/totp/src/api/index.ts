import { $module } from "alepha";
import { AlephaApiAudits } from "alepha/api/audits";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaOrm } from "alepha/orm";

import { TotpRealm } from "./TotpRealm.ts";

/**
 * The server half, which is almost nothing.
 *
 * That is the point of the example: two-factor authentication is not a feature
 * you build, it is a setting on a realm. `AlephaApiUsers` already carries
 * `MfaService`, `TotpService` and `MyMfaController`; `TotpRealm` turns them on.
 * There is no MFA code in this application at all.
 *
 * `AlephaApiAudits` is here for its admin surface rather than for anything this
 * app calls: clearing a user's second factor writes an audit entry, and the
 * back office should be able to show it. An admin page whose backing action is
 * missing from `/api/_links` hides itself, so leaving the module out would
 * silently remove the Audit log page rather than fail.
 *
 * @module totp.api
 */
export const TotpApi = $module({
  name: "totp.api",
  imports: [AlephaOrm, AlephaApiUsers, AlephaApiAudits],
  services: [TotpRealm],
});
