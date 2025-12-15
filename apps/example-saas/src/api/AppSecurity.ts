import { $userRealm } from "alepha/api/users";

export class AppSecurity {
  /**
   * Customer realm - for end users who can self-register.
   */
  customerRealm = $userRealm({
    realm: {
      name: "customer",
    },
    identities: {
      credentials: true,
      google: true,
    },
    settings: {
      displayName: "Customer Portal",
      description: "Book your next trip with us",
      registrationAllowed: true,
      resetPasswordAllowed: true,
      verifyEmailRequired: true,
      emailEnabled: true,
      emailRequired: true,
      usernameEnabled: false,
      usernameRequired: false,
    },
  });

  /**
   * Agent realm - for SaaS employees created via admin UI.
   * - Registration not allowed (agents are created by admins)
   * - Username is mandatory
   * - Only credentials login (no social)
   */
  agentRealm = $userRealm({
    modules: {
      files: true,
      jobs: true,
      audits: true,
    },
    realm: {
      name: "agent",
      roles: [
        {
          name: "admin",
          permissions: [{ name: "*" }],
        },
        {
          name: "supervisor",
          permissions: [
            { name: "agents:*" },
            { name: "customers:read" },
            { name: "bookings:*" },
            { name: "reports:read" },
          ],
        },
        {
          name: "support",
          permissions: [
            { name: "customers:read" },
            { name: "bookings:read" },
            { name: "bookings:update" },
          ],
        },
        {
          name: "operations",
          permissions: [
            { name: "inventory:*" },
            { name: "trips:*" },
            { name: "stations:read" },
          ],
        },
      ],
    },
    identities: {
      credentials: true,
    },
    settings: {
      displayName: "Agent Dashboard",
      description: "Internal access for team members",
      registrationAllowed: false,
      resetPasswordAllowed: true,
      verifyEmailRequired: false,
      emailEnabled: true,
      emailRequired: true,
      usernameEnabled: true,
      usernameRequired: true,
      firstNameLastNameEnabled: true,
      firstNameLastNameRequired: true,
    },
  });
}
