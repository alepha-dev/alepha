import { $hook } from "alepha";
import { SecurityProvider, type UserAccountToken } from "alepha/security";

/**
 * ⚠️ Demo only: every request is the same signed-in user, in a one-role
 * realm.
 *
 * The example is about the assistant, and a sign-in flow would bury it. A
 * real app keeps its own authentication (`alepha/api/users`, a realm), and
 * the assistant then runs as whoever is signed in: nothing in the AI modules
 * changes.
 */
export class DemoSecurityProvider extends SecurityProvider {
  protected readonly onConfigure = $hook({
    on: "configure",
    handler: () => {
      this.createRealm({
        name: "default",
        roles: [{ name: "member", permissions: [{ name: "*" }] }],
      });
    },
  });

  public override async resolveUserFromServerRequest(): Promise<UserAccountToken> {
    return { id: "demo-user", realm: "default", roles: ["member"] };
  }
}
