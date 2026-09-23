import { $inject } from "alepha";
import { $command } from "alepha/command";

import { LoreDeviceLogin } from "../services/LoreDeviceLogin.ts";

/**
 * `lore login` and `lore logout` - the OAuth 2.0 device flow
 * (RFC 8628), so a laptop can talk to Lore without pasting a token into a
 * shell.
 *
 * The flow itself is {@link LoreDeviceLogin}, shared with the platform
 * adapter's `login()`: this command is its name in the `lore` binary.
 *
 * ## The server half already existed
 *
 * `alepha/api/oauth` implements `POST /oauth/device_authorization` and the
 * `urn:ietf:params:oauth:grant-type:device_code` grant, with tests. Lore is
 * already an authorization server that can do this; nothing was added there.
 *
 * ## ⚠️ This is NOT the CI path, and the difference is load-bearing
 *
 * There is no human in CI to approve a code, so a runner that fell into this
 * flow would poll until it timed out - a job that hangs for fifteen minutes
 * and then fails for a reason its log does not explain. Two things prevent it,
 * and neither is a convention:
 *
 * - {@link LoreClientService.authorization} never STARTS a flow. A missing
 *   credential is an error naming both fixes, not a login prompt.
 * - `login` refuses to run in CI outright. It is only reachable by someone
 *   typing it, and in CI nobody is typing.
 *
 * ## ⚠️ NOT re-exported from `index.ts`
 *
 * Same rule as the other commands: it is registered as a service and reached
 * through `LoreCommand`, never named in a published signature.
 */
export class LoginCommand {
  protected readonly device = $inject(LoreDeviceLogin);

  public readonly login = $command({
    name: "login",
    description: "Sign in to a Lore instance from this machine",
    handler: async () => {
      await this.device.login();
    },
  });

  public readonly logout = $command({
    name: "logout",
    description: "Forget this machine's login for a Lore instance",
    handler: async () => {
      await this.device.logout();
    },
  });
}
