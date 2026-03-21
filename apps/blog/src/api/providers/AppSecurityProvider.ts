import { $env, t } from "alepha";
import { $realm } from "alepha/api/users";
import { $swagger } from "alepha/server/swagger";

export class AppSecurityProvider {
  env = $env(
    t.object({
      ADMIN_EMAIL: t.optional(t.email()),
    }),
  );

  docs = $swagger({
    info: {
      title: "Alepha Blog API",
      description: "Blog API documentation.",
      version: "1.0.0",
    },
  });

  realm = $realm({
    features: {
      apiKeys: true,
      audits: true,
      notifications: true,
      parameters: true,
      avatars: true,
      jobs: true,
    },
    identities: {
      google: true,
    },
    settings: {
      adminEmails: this.env.ADMIN_EMAIL ? [this.env.ADMIN_EMAIL] : [],
    },
  });
}
