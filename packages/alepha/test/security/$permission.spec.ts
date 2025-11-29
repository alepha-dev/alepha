import { Alepha } from "alepha";
import { $permission, $role } from "alepha/security";
import { describe, expect, it } from "vitest";

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
