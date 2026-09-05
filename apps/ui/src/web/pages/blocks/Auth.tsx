import { AuthLogin } from "@alepha/ui/components/auth/auth-login";
import { AuthRegister } from "@alepha/ui/components/auth/auth-register";
import { AuthResetPassword } from "@alepha/ui/components/auth/auth-reset-password";
import { z } from "alepha";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Showcase } from "@/web/components/Showcase.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

import { SHOWCASE_REALM } from "./showcaseRealm.ts";

/**
 * The auth screens, rendered against a fixture realm.
 *
 * They take their realm as a prop rather than fetching it, so the whole surface
 * works on a site with no users table. Nothing here signs anyone in: submitting
 * calls `useAuth`, which has no backend to reach, so the form reports a failure
 * - which is itself worth seeing, since the error state is part of the screen.
 */
const KNOBS = z.object({
  variant: z
    .enum(["centered", "split"])
    .default("centered")
    .meta({ title: "variant" }),
  registerLink: z.boolean().default(true).meta({ title: "Sign-up link" }),
  resetLink: z.boolean().default(true).meta({ title: "Forgot-password link" }),
});

const Auth = () => (
  <BlockPage
    title="Sign in & register"
    source="@alepha/ui/components/auth/*"
    description="The four screens behind /auth: login, register, reset password and verify email. Which credential fields and which social buttons appear is decided entirely by the realm config handed in as a prop."
  >
    <Showcase
      title="AuthLogin"
      description="`split` puts a branded panel beside the form on large screens and collapses back to centered on small ones. The two links are optional: omit the path and the link disappears."
      schema={KNOBS}
      initialValues={{
        variant: "centered",
        registerLink: true,
        resetLink: true,
      }}
      previewClassName="p-0 items-stretch"
    >
      {(v) => (
        <div className="w-full">
          <AuthLogin
            realmConfig={SHOWCASE_REALM}
            variant={v.variant}
            registerPath={v.registerLink ? "/blocks/auth" : undefined}
            resetPasswordPath={v.resetLink ? "/blocks/auth" : undefined}
          />
        </div>
      )}
    </Showcase>

    <Specimen
      title="AuthRegister"
      description="The fields come from the realm's own requirements, and the password rules are enforced against its policy rather than a hardcoded regex."
    >
      <AuthRegister realmConfig={SHOWCASE_REALM} loginPath="/blocks/auth" />
    </Specimen>

    <Specimen
      title="AuthResetPassword"
      description="Three steps in one component: ask for the address, take the code, set the new password. It walks them itself rather than needing three routes."
    >
      <AuthResetPassword
        realmConfig={SHOWCASE_REALM}
        loginPath="/blocks/auth"
      />
    </Specimen>
  </BlockPage>
);

export default Auth;
