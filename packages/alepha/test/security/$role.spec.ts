import { Alepha } from "alepha/core";
import { describe, expect, it } from "vitest";
import { $permission, $role } from "../../src/security";

describe("$role", () => {
  it("should accept permissions", async () => {
    class Roles {
      admin = $role({
        name: "admin",
        permissions: [
          {
            name: "*",
          },
        ],
      });
      user = $role({
        permissions: [
          {
            name: "*",
            ownership: true,
            exclude: ["admin:*"],
          },
        ],
      });
    }

    class Permissions {
      readFiles = $permission({
        group: "admin",
      });
      readFileById = $permission({
        group: "files",
      });
    }

    const alepha = Alepha.create();
    const roles = alepha.inject(Roles);
    const permissions = alepha.inject(Permissions);
    await alepha.start();

    expect(roles.admin.can(permissions.readFiles)).toBe(true);
    expect(roles.admin.check(permissions.readFiles).ownership).toBe(false);
    expect(roles.admin.check(permissions.readFileById).ownership).toBe(false);
    expect(roles.admin.can(permissions.readFileById)).toBe(true);
    expect(roles.user.can(permissions.readFileById)).toBe(true);

    // Because "admin:*" is excluded from user role
    expect(roles.user.can(permissions.readFiles)).toBe(false);
    expect(roles.user.check(permissions.readFiles).ownership).toBe(undefined);
    expect(roles.user.check(permissions.readFileById).ownership).toBe(true);
  });
});
