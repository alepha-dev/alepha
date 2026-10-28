import { type Infer, z } from "alepha";

import { environmentOptionsSchema } from "./environmentOptions.ts";

/**
 * What `bay()` takes: the shared `domain`, plus the ssh destination of the
 * machine, the path of Bay's control socket on it, and the stack the app is
 * deployed into, if any.
 */
export const bayEnvironmentOptionsSchema = environmentOptionsSchema.extend({
  /**
   * SSH destination of the Bay this environment deploys to, e.g.
   * `"deploy@bay.example.com"`. **Required**, here or through `$BAY_HOST`.
   *
   * Passed to the machine's own `ssh` binary verbatim, so it may be an
   * alias defined in `~/.ssh/config` (`"bay-prod"`). That is the point
   * of shelling out rather than speaking the protocol: `ProxyJump`,
   * `IdentityAgent`, `ControlMaster` and a per-host `User` are already
   * configured there, and stay in one place.
   *
   * There is deliberately no port, identity-file or extra-flags field
   * for the same reason. Committing this is fine: it is a hostname,
   * and the SSH key is what protects it.
   *
   * `$BAY_HOST` overrides, so CI needs no edit to a committed config.
   */
  host: z.text().optional(),
  /**
   * Absolute path to Bay's control socket on the host, e.g.
   * `"/var/lib/bay/control.sock"`.
   *
   * Bay's default root is the *relative* path `./bay-data`, and an ssh
   * command runs non-interactively with cwd `$HOME`, so on any host
   * whose Bay root is not `$HOME/bay-data` (every `--root /var/lib/bay`
   * install, for one), Bay's own guess at the socket path misses and
   * every command this adapter sends fails to find it. `$BAY_SOCKET` on
   * the Bay host is Bay's own escape hatch for this, but it cannot be
   * relied on here: a non-interactive ssh command reads neither
   * `~/.profile` nor, on Debian/Ubuntu's default, `~/.bashrc`, so there
   * is nowhere reliable to export it from.
   *
   * `$BAY_SOCKET` in the CLI's own environment overrides this value,
   * the same way `$BAY_HOST` overrides `host`.
   */
  socket: z.text().optional(),
  /**
   * The Bay stack this app is deployed into, e.g. `"mcs"`.
   *
   * A stack is a `compose.yml` applied on the Bay (`bay stack deploy`, or
   * `lore stack deploy`): the app runs as the service whose
   * `x-lore: { app: <name> }` names it, next to Postgres, Redis or anything
   * else the file declares. The environment's name is the stack
   * environment's, so `alepha deploy staging` deploys into `mcs/staging`
   * and redeploys only this app's service, as
   * `bay deploy mcs/staging/<service> -`.
   *
   * The stack must have been deployed first: the service is found by asking
   * the Bay, and a stack environment that does not exist yet has none. With
   * a stack, `domain` is not used: the service's routes come from the
   * stack (`x-lore.routes`, `bay stack route`).
   *
   * Without it, the app is deployed on its own, as `bay deploy - --name <app>`.
   *
   * `$BAY_STACK` overrides, the same way `$BAY_HOST` overrides `host`.
   */
  stack: z.text().optional(),
});

export type BayEnvironmentOptions = Infer<typeof bayEnvironmentOptionsSchema>;
