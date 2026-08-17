import { $env, z } from "alepha";
import { $realm } from "alepha/api/users";
import { $permission } from "alepha/security";

/**
 * Who may do what in the shop.
 *
 * Customers register to keep an address book and see their past orders; buying
 * needs no account at all, which is why every checkout route is open and only
 * `/admin` is not. The sign-in screens themselves (`/auth/*`, mounted by
 * `AuthRouter`) are public by definition.
 *
 * `contact@atelier-aurore.test` is seeded as the administrator through
 * `adminEmails`: the first registration with that address is promoted, and the
 * admin role carries `*` so it inherits the three commerce permissions the
 * back office declares.
 */
export class ShopRealm {
  /*
   * Extra administrators, comma-separated — kept out of the repository.
   *
   * The seeded `…@atelier-aurore.test` address below is invented and safe to
   * commit; a real one is not, and this is a public repository. So it comes from
   * the environment, which also means it travels the right way: only `$env`-
   * declared keys reach the build manifest, and the manifest is what the deploy
   * turns into Worker secrets.
   */
  protected readonly env = $env(
    z.object({
      ADMIN_EMAIL: z
        .text({
          description:
            "Comma-separated addresses promoted to administrator on sign-in.",
        })
        .optional(),
    }),
  );

  /** Opens the `/admin` shell. Distinct from the commerce permissions below. */
  adminUi = $permission({
    group: "admin",
    name: "ui",
    description: "Ouvre l'espace d'administration",
  });

  /** Declared here because `@alepha/commerce/admin` requires them by name. */
  commerceRead = $permission({
    group: "admin:commerce",
    name: "read",
    description: "Consulter le catalogue et les commandes",
  });

  commerceWrite = $permission({
    group: "admin:commerce",
    name: "write",
    description: "Modifier le catalogue, expédier les commandes",
  });

  /**
   * Separate from `write` on purpose: sending money back is not the same trust
   * level as correcting a product name.
   */
  commerceRefund = $permission({
    group: "admin:commerce",
    name: "refund",
    description: "Rembourser une commande",
  });

  /**
   * The seeded demo administrator, plus whatever `ADMIN_EMAIL` adds.
   *
   * Promotion happens at **session creation**, not at registration — so an
   * address added here gets the role on its owner's next sign-in, and an account
   * that already exists is not rewritten retroactively.
   */
  protected adminEmails(): string[] {
    const extra = String(this.env.ADMIN_EMAIL ?? "")
      .split(",")
      .map((address) => address.trim())
      .filter(Boolean);

    return ["contact@atelier-aurore.test", ...extra];
  }

  realm = $realm({
    settings: {
      displayName: "Atelier Aurore",
      description: "Bijoux façonnés à Paris.",
      adminEmails: this.adminEmails(),
      registrationAllowed: true,
      email: "required",
      username: "none",
      firstNameLastName: "optional",
      phoneNumber: "none",
      /*
       * All three need `features: { notifications: true }` to send their
       * codes, and this realm declares no features at all, so all three are
       * off.
       *
       * `resetPasswordAllowed` read `true` here until the framework started
       * refusing that combination. It was never true in practice: `$realm`
       * quietly overwrote it, so the deployed shop hid the "forgot password"
       * link and rejected every reset request while this file claimed
       * otherwise. The value below is what the shop has always actually done.
       *
       * A demo shop that made you check your inbox before browsing would be
       * tiresome; a real one turns notifications on and then flips these.
       */
      verifyEmailRequired: false,
      verifyPhoneRequired: false,
      resetPasswordAllowed: false,
      captchaRequired: false,
      defaultRoles: ["user"],
      passwordPolicy: {
        minLength: 8,
        requireUppercase: false,
        requireLowercase: false,
        requireNumbers: false,
        requireSpecialCharacters: false,
      },
    },
  });
}
