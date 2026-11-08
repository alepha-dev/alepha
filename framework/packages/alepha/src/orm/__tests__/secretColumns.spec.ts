import { z } from "alepha";
import { apiKeyEntity } from "alepha/api/keys";
import { oauthClientEntity } from "alepha/api/oauth";
import { identities, sessions } from "alepha/api/users";
import { verifications } from "alepha/api/verifications";
import { describe, it } from "vitest";

import { $entity, db } from "../core/index.ts";

const accounts = $entity({
  name: "secret_columns_test",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    email: z.text(),
    password: z.text().meta({ secret: true }).optional(),
    pin: z.text({ secret: true }).default("0000"),
    resetToken: z.text().optional().meta({ secret: true }),
    note: z.text().meta({ secret: false }),
    odd: z.text().meta({ secret: "yes" as any }),
  }),
});

describe("EntityPrimitive.secretColumns", () => {
  it("reads secret: true through the optional and default wrappers", ({
    expect,
  }) => {
    expect(accounts.secretColumns).toEqual(["password", "pin", "resetToken"]);
  });

  it("leaves an unmarked, a declassified and a non-boolean column visible", ({
    expect,
  }) => {
    for (const name of ["id", "email", "note", "odd"]) {
      expect(accounts.secretColumns).not.toContain(name);
    }
  });

  it("marks the framework's credential columns", ({ expect }) => {
    expect(identities.secretColumns).toEqual(["password"]);
    expect(sessions.secretColumns).toEqual(["refreshToken"]);
    expect(apiKeyEntity.secretColumns).toEqual(["tokenHash"]);
    expect(oauthClientEntity.secretColumns).toEqual(["clientSecretHash"]);
    expect(verifications.secretColumns).toEqual(["code"]);
  });
});
