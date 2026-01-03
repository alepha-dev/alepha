import { t } from "alepha";
import type { UserRealmConfig } from "alepha/api/users";
import ResetPassword from "../../../auth/components/ResetPassword.tsx";
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
}): UserRealmConfig => {
  return {
    realmName: "demo",
    authenticationMethods: [{ name: "credentials", type: "CREDENTIALS" }],
    settings: {
      displayName: props.showBranding ? "Demo App" : undefined,
      description: props.showBranding ? "Reset your password" : undefined,
      logoUrl: undefined,
      registrationAllowed: true,
      emailEnabled: true,
      emailRequired: true,
      usernameEnabled: false,
      usernameRequired: false,
      phoneEnabled: false,
      phoneRequired: false,
      verifyEmailRequired: false,
      verifyPhoneRequired: false,
      firstNameLastNameEnabled: false,
      firstNameLastNameRequired: false,
      resetPasswordAllowed: props.resetPasswordAllowed,
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
