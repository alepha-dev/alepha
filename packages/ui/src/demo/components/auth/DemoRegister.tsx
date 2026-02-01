import { t } from "alepha";
import type { RealmConfig } from "alepha/api/users";
import Register from "../../../auth/components/Register.tsx";
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
    title: "Username Field",
    default: true,
    $control: { switch: true },
  }),
  usernameRequired: t.boolean({
    title: "Username Required",
    default: false,
    $control: { switch: true },
  }),
  emailEnabled: t.boolean({
    title: "Email Field",
    default: true,
    $control: { switch: true },
  }),
  emailRequired: t.boolean({
    title: "Email Required",
    default: true,
    $control: { switch: true },
  }),
  phoneEnabled: t.boolean({
    title: "Phone Field",
    default: false,
    $control: { switch: true },
  }),
  phoneRequired: t.boolean({
    title: "Phone Required",
    default: false,
    $control: { switch: true },
  }),
  registrationAllowed: t.boolean({
    title: "Registration Allowed",
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
  usernameRequired: boolean;
  emailEnabled: boolean;
  emailRequired: boolean;
  phoneEnabled: boolean;
  phoneRequired: boolean;
  registrationAllowed: boolean;
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
      description: props.showBranding ? "Create your account" : undefined,
      logoUrl: undefined,
      registrationAllowed: props.registrationAllowed,
      emailEnabled: props.emailEnabled,
      emailRequired: props.emailRequired,
      usernameEnabled: props.usernameEnabled,
      usernameRequired: props.usernameRequired,
      usernameRegExp: "^[a-zA-Z0-9_]{3,30}$",
      phoneEnabled: props.phoneEnabled,
      phoneRequired: props.phoneRequired,
      verifyEmailRequired: false,
      verifyPhoneRequired: false,
      firstNameLastNameEnabled: false,
      firstNameLastNameRequired: false,
      resetPasswordAllowed: true,
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

const DemoRegister = () => {
  return (
    <Showcase
      title="Register"
      schema={showcaseSchema}
      initialValues={{
        showCredentials: true,
        showGoogleOAuth: true,
        showGithubOAuth: false,
        usernameEnabled: true,
        usernameRequired: false,
        emailEnabled: true,
        emailRequired: true,
        phoneEnabled: false,
        phoneRequired: false,
        registrationAllowed: true,
        showBranding: true,
      }}
      columns={1}
    >
      {(props) => <Register realmConfig={buildRealmConfig(props)} />}
    </Showcase>
  );
};

export default DemoRegister;
