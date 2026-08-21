import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, SecurityProvider } from "alepha/security";
import { describe, expect, it } from "vitest";

import { AlephaApiUsers } from "../index.ts";
import { $realm } from "../primitives/$realm.ts";

/**
 * `features.audits` must register the audits MODULE, not only the two
 * `$audit` holder classes.
 *
 * `AlephaApiAudits` carries `AdminAuditController`, whose
 * `$secure({ permissions: ["admin:audit:read"] })` is the only thing that
 * declares that permission. A permission nothing declares cannot be granted
 * to anyone — not even an admin holding the `*` wildcard, because
 * `SecurityProvider.getPermissions()` expands `*` against the container's
 * live registry. So without the module the admin Audits page is unreachable
 * AND invisible, with no error anywhere to say why.
 */
describe("$realm features.audits", () => {
  const declaredPermissions = async (audits: boolean) => {
    class App {
      realm = $realm({ features: { audits } });
    }

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error" },
    });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    alepha.with(App);
    await alepha.start();

    return alepha
      .inject(SecurityProvider)
      .getPermissions()
      .map((it) => [it.group, it.name].filter(Boolean).join(":"));
  };

  it("declares admin:audit:read when audits are on", async () => {
    expect(await declaredPermissions(true)).toContain("admin:audit:read");
  });

  it("does not declare admin:audit:read when audits are off", async () => {
    expect(await declaredPermissions(false)).not.toContain("admin:audit:read");
  });
});
