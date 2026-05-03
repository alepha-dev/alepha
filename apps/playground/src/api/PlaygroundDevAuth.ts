import { $hook, $inject } from "alepha";
import { SecurityProvider } from "alepha/security";

/**
 * Injects a fake admin user on every request so `$secure()`-gated admin
 * endpoints (audits, notifications, files, parameters, jobs) work out of
 * the box in the playground — no login required.
 *
 * Remove this provider once real auth is wired in the app.
 */
export class PlaygroundDevAuth {
  protected readonly security = $inject(SecurityProvider);

  protected readonly onStart = $hook({
    on: "start",
    priority: "first",
    handler: async () => {
      this.security.createRealm({
        name: "dev",
        roles: [
          {
            name: "dev-admin",
            description: "Playground dev role — all permissions.",
            permissions: [{ name: "*" }],
          },
        ],
      });
    },
  });

  protected readonly onRequest = $hook({
    on: "server:onRequest",
    handler: async ({ request }) => {
      if (request.user) return;
      request.user = {
        // FileService and other admin entities require a UUID creator.
        id: "00000000-0000-4000-8000-000000000001",
        name: "Playground Dev",
        email: "dev@alepha.local",
        realm: "dev",
        roles: ["dev-admin"],
      } as never;
    },
  });
}
