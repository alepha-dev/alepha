import { t } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import Login from "../../../auth/components/Login.tsx";
import Showcase from "../shared/Showcase.tsx";

const showcaseSchema = t.object({
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
  usernameEnabled: t.boolean({
    title: "Username Login",
    default: true,
    $control: { switch: true },
  }),
  emailEnabled: t.boolean({
    title: "Email Login",
    default: true,
    $control: { switch: true },
  }),
  phoneEnabled: t.boolean({
    title: "Phone Login",
    default: false,
    $control: { switch: true },
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
  usernameEnabled: boolean;
  emailEnabled: boolean;
  phoneEnabled: boolean;
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
      emailEnabled: props.emailEnabled,
      emailRequired: false,
      usernameEnabled: props.usernameEnabled,
      usernameRegExp: "^[a-zA-Z0-9_]{3,30}$",
      usernameRequired: false,
      phoneEnabled: props.phoneEnabled,
      phoneRequired: false,
      verifyEmailRequired: false,
      verifyPhoneRequired: false,
      firstNameLastNameEnabled: false,
      firstNameLastNameRequired: false,
      resetPasswordAllowed: props.resetPasswordAllowed,
      adminEmails: [],
      adminUsernames: [],
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialCharacters: false,
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
        showCredentials: true,
        showGoogleOAuth: true,
        showGithubOAuth: false,
        usernameEnabled: true,
        emailEnabled: true,
        phoneEnabled: false,
        registrationAllowed: true,
        resetPasswordAllowed: true,
        showBranding: true,
      }}
      columns={1}
    >
      {(props) => <Login realmConfig={buildRealmConfig(props)} />}
    </Showcase>
  );
};

export default DemoLogin;
