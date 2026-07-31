import { $env, $hook, $inject, z } from "alepha";
import { RealmProvider, UserService } from "alepha/api/users";
import { $logger } from "alepha/logger";

/**
 * Creates the one operator account, once, at first boot.
 *
 * Pulse has no sign-up form and no way to send a mail, so an account has
 * to exist before anyone can log in. This is that account.
 *
 * **The password is generated, not `admin`.** Pulse is reachable over
 * HTTPS from anywhere, and what it holds is every enrolled app's ingest key
 * plus the error stacks and traffic of every site reporting to it. Not
 * root-equivalent like Bay's panel, but a default password there still hands a
 * scanner the ability to forge another site's analytics and read its crashes.
 *
 * The window is not "until the operator changes it" — it is "from first boot",
 * before anyone has logged in once.
 *
 * The generated password is printed **once**, at `warn`, on the boot that
 * creates the account. An operator running `bay deploy` is already on the
 * host; reading one line of `journalctl` is not the hard part of setting up a
 * server.
 *
 * Set `PULSE_ADMIN_PASSWORD` to choose it instead — for an automated install,
 * or for someone who wants a known value. It is used only when the account is
 * created; changing it later does nothing, because at that point the password
 * lives hashed in the database and the profile page is how it changes.
 */
export class BootstrapService {
  protected readonly log = $logger();
  protected readonly users = $inject(UserService);
  protected readonly realmProvider = $inject(RealmProvider);

  protected readonly env = $env(
    z.object({
      PULSE_ADMIN_USERNAME: z.text({ default: "admin" }),
      PULSE_ADMIN_PASSWORD: z
        .text({
          description:
            "Password for the bootstrap account. Generated and printed once when absent. Only read on the boot that creates the account.",
        })
        .optional(),
    }),
  );

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      // The first name only. `PULSE_ADMIN_USERNAME` is a list because it grants
      // the admin role to several people, but exactly one account is created.
      const username = this.env.PULSE_ADMIN_USERNAME.split(",")[0].trim();

      const existing = await this.realmProvider.userRepository().findOne({
        where: { username: { eqInsensitive: username } },
      });
      if (existing) {
        return;
      }

      const password = this.env.PULSE_ADMIN_PASSWORD ?? this.generatePassword();
      const user = await this.users.createUser({ username, roles: ["admin"] });
      await this.users.setPassword(user.id, password);

      if (this.env.PULSE_ADMIN_PASSWORD) {
        this.log.info("Created the Pulse account", { username });
        return;
      }

      // Printed as a block rather than as structured fields: a log aggregator
      // that pretty-prints one line is how this gets missed, and there is no
      // second chance to read it.
      this.log.warn(
        [
          "",
          "  ┌─────────────────────────────────────────────────────────┐",
          "  │  Pulse account created — this is shown ONCE         │",
          "  └─────────────────────────────────────────────────────────┘",
          `     username   ${username}`,
          `     password   ${password}`,
          "",
          "     Change it from the profile page after signing in.",
          "     Set PULSE_ADMIN_PASSWORD before first boot to choose it.",
          "",
        ].join("\n"),
      );
    },
  });

  /**
   * A password a person can read off a terminal and type once.
   *
   * Hyphenated groups from an unambiguous alphabet: no `0`/`O`, no `1`/`l`/`I`.
   * The one time this is transcribed by hand is from a log line to a browser,
   * and a character someone types wrong reads as a wrong password with no hint
   * that it was a typo.
   *
   * 20 characters from a 32-symbol alphabet is 100 bits. The generator is the
   * platform CSPRNG.
   */
  protected generatePassword(): string {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
    return [
      chars.slice(0, 5).join(""),
      chars.slice(5, 10).join(""),
      chars.slice(10, 15).join(""),
      chars.slice(15, 20).join(""),
    ].join("-");
  }
}
