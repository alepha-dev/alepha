import { $module, Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { describe, expect, it } from "vitest";

import { $audit, AlephaApiAudits } from "../index.ts";
import { AuditService } from "../services/AuditService.ts";

/**
 * Two types that both declare `create`: the collision feedback #2049 was
 * about. A filter fed bare action names offered one `create` and selected
 * both types' rows with it.
 */
class UserAudits {
  audit = $audit({
    type: "user",
    description: "Account events",
    actions: ["create", "delete"],
  });
}

class ParameterAudits {
  audit = $audit({
    type: "parameter",
    description: "Parameter versions",
    actions: ["create", "rollback"],
  });
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaOrmPostgres)
    .with(AlephaSecurity)
    .with(AlephaApiAudits)
    .with(
      $module({
        name: "test.audits.pairs",
        services: [UserAudits, ParameterAudits],
      }),
    );

  const audits = alepha.inject(AuditService);
  const users = alepha.inject(UserAudits);
  const parameters = alepha.inject(ParameterAudits);
  await alepha.start();
  return { alepha, audits, users, parameters };
};

describe("audit action pairs", () => {
  it("lists every (type, action) pair, sorted by type then action", async () => {
    const { audits } = await setup();

    const pairs = audits.getDistinctActions();

    // `create` appears once per type that declares it, never collapsed.
    expect(pairs).toEqual([
      { type: "parameter", action: "create" },
      { type: "parameter", action: "rollback" },
      { type: "user", action: "create" },
      { type: "user", action: "delete" },
    ]);
  });

  it("filters on the pair, and on the type alone", async () => {
    const { audits, users, parameters } = await setup();

    await users.audit.log("create", { resourceId: "u1" });
    await users.audit.log("delete", { resourceId: "u1" });
    await parameters.audit.log("create", { resourceId: "p1" });

    // Both halves: only that type's action.
    const userCreates = await audits.find({ type: "user", action: "create" });
    expect(userCreates.content.map((a) => `${a.type}:${a.action}`)).toEqual([
      "user:create",
    ]);

    // The type alone still selects every action within it.
    const userRows = await audits.find({ type: "user", sort: "action" });
    expect(userRows.content.map((a) => `${a.type}:${a.action}`)).toEqual([
      "user:create",
      "user:delete",
    ]);

    // The bare action is what the filter used to send: it selects across
    // types, which is the reading the pairs exist to avoid.
    const creates = await audits.find({ action: "create" });
    expect(creates.content).toHaveLength(2);
  });
});
