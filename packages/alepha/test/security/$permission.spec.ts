import { Alepha } from "alepha/core";
import { describe, expect, it } from "vitest";
import { $permission, $role } from "../../src/security";

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
});
