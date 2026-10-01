import { changelog } from "alepha/cli";
import { defineConfig } from "alepha/cli/config";

import { AlephaCommands } from "./scripts/commands.ts";

export default defineConfig({
  plugins: [
    // The changelog is the release note for everything this repository ships:
    // the `alepha` modules, its `api/*` sub-modules and every published
    // `@alepha/*` package. Everything else, the examples and the private
    // packages, is invisible here without anyone having to remember it.
    //
    // `lore` and `bay` were added in 0.29, when Lore and Bay were products
    // shipped from this repository with their own pages on the site. They
    // left with their repositories in #E72, and their past entries stay in
    // CHANGELOG.md.
    //
    // This was a denylist until 0.25, and the denylist is why `pulse` and
    // `shop` reached the notes for a release nobody shipped them in: it only
    // ever excluded what someone thought to add, and an app born after the
    // last edit is published by default. An allowlist fails the other way,
    // which is the one you notice: a missing entry gets reported, a leaked one
    // does not.
    //
    // Scopes match on the segment before `/`, so `api` covers `api/users` and
    // `react` covers `react/form`.
    changelog({
      types: ["feat", "fix"],
      scopes: [
        // alepha: modules
        "api",
        "background",
        "bucket",
        "cache",
        "captcha",
        "cli",
        "command",
        "core",
        "crypto",
        "datetime",
        "email",
        "lock",
        "logger",
        "mcp",
        "orm",
        "queue",
        "react",
        "redis",
        "router",
        "scheduler",
        "security",
        "server",
        "sms",
        "system",
        "testing",
        "topic",
        "websocket",
        // alepha: api sub-modules, also written bare
        "analytics",
        "audits",
        "files",
        "jobs",
        "keys",
        "notifications",
        "oauth",
        "parameters",
        "payments",
        "subscriptions",
        "users",
        "verifications",
        // published packages
        "devtools",
        "payments-stripe",
        "protobuf",
        "sigil",
        "ui",
        // surfaces that live inside a module and are named on their own
        "auth",
        "cookies",
        "platform",
      ],
    }),
  ],
  // The repository's own commands: `clean` and `verify` / `v`. Each takes the
  // slot of the CLI built-in with the same name, since the CLI keeps the last
  // registration and these register after the core.
  services: [AlephaCommands],
});
