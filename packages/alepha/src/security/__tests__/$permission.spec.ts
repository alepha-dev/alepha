import { Alepha, AlephaError } from "alepha";
import { describe, expect, it } from "vitest";

import { $issuer, $permission, $role } from "../index.ts";

describe("$permission", () => {
  it("should check if user has permission based on role", async () => {
    const alepha = Alepha.create();

    class App {
      hello = $permission();
      world = $permission();

      user = $role({
        permissions: ["App:hello"],
      });
    }

    const app = alepha.inject(App);

    await alepha.start();

    const user = {
      id: "1",
      roles: ["user"],
    };

    expect(app.world.can(user)).toEqual(false);
    expect(app.hello.can(user)).toEqual(true);
  });

  it("should resolve the user's roles inside the user's own realm", async () => {
    const alepha = Alepha.create();

    class App {
      hello = $permission();

      staff = $issuer({ secret: "staff-secret-staff-secret-staff!" });
      customers = $issuer({ secret: "customer-secret-customer-secret!" });

      // Two realms, one role name. The customer "admin" grants nothing.
      staffAdmin = $role({
        name: "admin",
        issuer: "staff",
        permissions: ["App:hello"],
      });

      customerAdmin = $role({
        name: "admin",
        issuer: "customers",
        permissions: [],
      });
    }

    const app = alepha.inject(App);

    await alepha.start();

    expect(
      app.hello.can({ id: "1", roles: ["admin"], realm: "staff" }),
    ).toEqual(true);

    expect(
      app.hello.can({ id: "2", roles: ["admin"], realm: "customers" }),
    ).toEqual(false);
  });

  it("should accept an issuer passed by reference", async () => {
    const alepha = Alepha.create();

    class App {
      hello = $permission();

      staff = $issuer({ secret: "staff-secret-staff-secret-staff!" });
      customers = $issuer({ secret: "customer-secret-customer-secret!" });

      staffAdmin = $role({
        name: "admin",
        issuer: this.staff,
        permissions: ["App:hello"],
      });

      customerAdmin = $role({
        name: "admin",
        issuer: this.customers,
        permissions: [],
      });
    }

    const app = alepha.inject(App);

    await alepha.start();

    expect(
      app.hello.can({ id: "1", roles: ["admin"], realm: "staff" }),
    ).toEqual(true);

    expect(
      app.hello.can({ id: "2", roles: ["admin"], realm: "customers" }),
    ).toEqual(false);
  });

  it("should refuse an issuer reference declared after the role", () => {
    const alepha = Alepha.create();

    class App {
      // `this.staff` is still undefined here, so the reference used to read as
      // "no issuer" and the role landed in every realm. TypeScript flags it
      // too (TS2729); the guard is what covers plain JS and any indirection
      // the compiler cannot see through.
      // @ts-expect-error - used before its initialization, on purpose
      staffAdmin = $role({ name: "admin", issuer: this.staff });

      staff = $issuer({ secret: "staff-secret-staff-secret-staff!" });
    }

    expect(() => alepha.inject(App)).toThrow(AlephaError);
  });
});
