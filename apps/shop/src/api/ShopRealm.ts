import { $realm } from "alepha/api/users";
import { $permission } from "alepha/security";

/**
 * Who may do what in the shop.
 *
 * Customers register to keep an address book and see their past orders; buying
 * needs no account at all, which is why every checkout route is open and only
 * `/compte` and `/admin` are not.
 *
 * `contact@atelier-aurore.test` is seeded as the administrator through
 * `adminEmails`: the first registration with that address is promoted, and the
 * admin role carries `*` so it inherits the three commerce permissions the
 * back office declares.
 */
export class ShopRealm {
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

  realm = $realm({
    settings: {
      displayName: "Atelier Aurore",
      description: "Bijoux façonnés à Paris.",
      adminEmails: ["contact@atelier-aurore.test"],
      registrationAllowed: true,
      email: "required",
      username: "none",
      firstNameLastName: "optional",
      phoneNumber: "none",
      // A demo shop that made you check your inbox before browsing would be
      // tiresome; a real one turns this on.
      verifyEmailRequired: false,
      verifyPhoneRequired: false,
      resetPasswordAllowed: true,
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
