import { ResetPassword } from "@alepha/ui/auth";
import { t } from "alepha";
import type { FieldRequirement, RealmConfig } from "alepha/api/users";
import Showcase from "../shared/Showcase.tsx";

const showcaseSchema = t.object({
  resetPasswordAllowed: t.boolean({
    title: "Reset Allowed",
    default: true,
    $control: { switch: true },
  }),
  showBranding: t.boolean({
    title: "Show Branding",
    default: true,
    $control: { switch: true },
  }),
});

const buildRealmConfig = (props: {
  resetPasswordAllowed: boolean;
  showBranding: boolean;
}): RealmConfig => {
  return {
    realmName: "demo",
    authenticationMethods: [{ name: "credentials", type: "CREDENTIALS" }],
    settings: {
      displayName: props.showBranding ? "Demo App" : undefined,
      description: props.showBranding ? "Reset your password" : undefined,
      logoUrl: undefined,
      registrationAllowed: true,
      email: "required" as FieldRequirement,
      username: "none" as FieldRequirement,
      usernameRegExp: "^[a-zA-Z0-9_]{3,30}$",
      phoneNumber: "none" as FieldRequirement,
      verifyEmailRequired: false,
      verifyPhoneRequired: false,
      firstNameLastName: "none" as FieldRequirement,
      resetPasswordAllowed: props.resetPasswordAllowed,
      adminEmails: [],
      adminUsernames: [],
      defaultRoles: [],
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialCharacters: false,
      },
      loginRateLimit: {
        ipMaxAttempts: 15,
        accountMaxAttempts: 5,
        windowMs: 15 * 60 * 1000,
      },
    },
  };
};

const DemoResetPassword = () => {
  return (
    <Showcase
      title="ResetPassword"
      schema={showcaseSchema}
      initialValues={{
        resetPasswordAllowed: true,
        showBranding: true,
      }}
      columns={1}
    >
      {(props) => <ResetPassword realmConfig={buildRealmConfig(props)} />}
    </Showcase>
  );
};

export default DemoResetPassword;
