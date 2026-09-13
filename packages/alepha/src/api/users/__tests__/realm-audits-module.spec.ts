import { Alepha } from "alepha";
import { AuditService } from "alepha/api/audits";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, SecurityProvider } from "alepha/security";
import { describe, expect, it } from "vitest";

import { SessionAudits } from "../audits/SessionAudits.ts";
import { UserAudits } from "../audits/UserAudits.ts";
import { AlephaApiUsers } from "../index.ts";
import { UserJobs } from "../jobs/UserJobs.ts";
import { $realm, type RealmFeatures } from "../primitives/$realm.ts";
import { UserService } from "../services/UserService.ts";

/**
 * A feature flag gates a surface, not infrastructure (#Q2096).
 *
 * `$realm` used to register `UserAudits`, `SessionAudits` and `UserJobs` only
 * when `features.audits` / `features.jobs` were on, both off by default. What
 * that actually switched off was the user and session audit trail, and the
 * only job that deletes session rows, so every application left at the
 * defaults grew its `sessions` table forever.
 *
 * The audits MODULE comes with them: `AlephaApiAudits` carries
 * `AdminAuditController`, whose `$secure` is the only declaration of
 * `admin:audit:read`, and a permission nothing declares cannot be granted,
 * not even to an admin holding `*`.
 */
describe("$realm jobs and audits are infrastructure", () => {
  const boot = async (features?: Partial<RealmFeatures>) => {
    class App {
      realm = $realm({ features });
    }

    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error" },
    });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    alepha.with(App);
    await alepha.start();

    return alepha;
  };

  const declaredPermissions = (alepha: Alepha) =>
    alepha
      .inject(SecurityProvider)
      .getPermissions()
      .map((it) => [it.group, it.name].filter(Boolean).join(":"));

  it("registers the audit types, the session purge and the audits module for a realm declaring no features", async () => {
    const alepha = await boot();

    expect(alepha.has(UserAudits)).toBe(true);
    expect(alepha.has(SessionAudits)).toBe(true);
    expect(alepha.has(UserJobs)).toBe(true);
    expect(declaredPermissions(alepha)).toContain("admin:audit:read");
  });

  it("ignores audits: false and jobs: false, which still typecheck", async () => {
    // Kept on `RealmFeatures`, deprecated, so applications that set them
    // upgrade by changing behaviour only.
    const alepha = await boot({ audits: false, jobs: false });

    expect(alepha.has(UserAudits)).toBe(true);
    expect(alepha.has(SessionAudits)).toBe(true);
    expect(alepha.has(UserJobs)).toBe(true);
    expect(declaredPermissions(alepha)).toContain("admin:audit:read");
  });

  it("writes the user audit trail from the services with audits: false", async () => {
    const alepha = await boot({ audits: false });

    const user = await alepha
      .inject(UserService)
      .createUser({ username: `audited-${crypto.randomUUID().slice(0, 8)}` });

    const page = await alepha
      .inject(AuditService)
      .find({ type: "user", action: "create" });
    expect(page.content.some((row) => row.resourceId === user.id)).toBe(true);
  });
});
