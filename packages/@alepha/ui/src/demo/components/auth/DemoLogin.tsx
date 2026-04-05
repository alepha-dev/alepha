import { Login } from "@alepha/ui/auth";
import { t } from "alepha";
import type { FieldRequirement, RealmConfig } from "alepha/api/users";
import Showcase from "../shared/Showcase.tsx";

const showcaseSchema = t.object({
  variant: t.string({
    title: "Variant",
    default: "card",
    enum: ["card", "split"],
  }),
  showCredentials: t.boolean({
    title: "Credentials",
    default: true,
    $control: { switch: true },
  }),
  showGoogleOAuth: t.boolean({
    title: "Google OAuth",
    default: true,
    $control: { switch: true },
  }),
  showGithubOAuth: t.boolean({
    title: "GitHub OAuth",
    default: false,
    $control: { switch: true },
  }),
  username: t.string({
    title: "Username",
    default: "optional",
    enum: ["none", "optional", "required"],
  }),
  email: t.string({
    title: "Email",
    default: "optional",
    enum: ["none", "optional", "required"],
  }),
  phoneNumber: t.string({
    title: "Phone Number",
    default: "none",
    enum: ["none", "optional", "required"],
  }),
  registrationAllowed: t.boolean({
    title: "Show Sign Up",
    default: true,
    $control: { switch: true },
  }),
  resetPasswordAllowed: t.boolean({
    title: "Forgot Password",
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
  showCredentials: boolean;
  showGoogleOAuth: boolean;
  showGithubOAuth: boolean;
  username: string;
  email: string;
  phoneNumber: string;
  registrationAllowed: boolean;
  resetPasswordAllowed: boolean;
  showBranding: boolean;
}): RealmConfig => {
  const authMethods: RealmConfig["authenticationMethods"] = [];

  if (props.showCredentials) {
    authMethods.push({ name: "credentials", type: "CREDENTIALS" });
  }
  if (props.showGoogleOAuth) {
    authMethods.push({ name: "google", type: "OAUTH2" });
  }
  if (props.showGithubOAuth) {
    authMethods.push({ name: "github", type: "OAUTH2" });
  }

  return {
    realmName: "demo",
    authenticationMethods: authMethods,
    settings: {
      displayName: props.showBranding ? "Demo App" : undefined,
      description: props.showBranding ? "Sign in to continue" : undefined,
      logoUrl: undefined,
      registrationAllowed: props.registrationAllowed,
      email: props.email as FieldRequirement,
      username: props.username as FieldRequirement,
      usernameRegExp: "^[a-zA-Z0-9_]{3,30}$",
      phoneNumber: props.phoneNumber as FieldRequirement,
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

const DemoLogin = () => {
  return (
    <Showcase
      title="Login"
      schema={showcaseSchema}
      initialValues={{
        variant: "card",
        showCredentials: true,
        showGoogleOAuth: true,
        showGithubOAuth: false,
        username: "optional",
        email: "optional",
        phoneNumber: "none",
        registrationAllowed: true,
        resetPasswordAllowed: true,
        showBranding: true,
      }}
      columns={1}
    >
      {(props) => (
        <Login
          realmConfig={buildRealmConfig(props)}
          variant={props.variant as "card" | "split"}
        />
      )}
    </Showcase>
  );
};

export default DemoLogin;
