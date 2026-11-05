import { z } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { Control } from "../form/Control.tsx";

// `z.string()`, uncapped: a JWT passes `z.text()`'s 255, and a cap above 256
// turns the control into a textarea instead of a password input.
const credentialFieldSchema = z.object({ token: z.string().optional() });

export interface SwaggerCredentialsProps {
  onChange: (token: string) => void;
}

/**
 * A bearer token or API key to send instead of the session, for an app with
 * no sign-in, or to call as another principal. Sent as
 * `Authorization: Bearer <token>`, which the server prefers to the session
 * cookie. Held in memory only: it is gone on reload, on purpose.
 */
export const SwaggerCredentials = (props: SwaggerCredentialsProps) => {
  const { tr } = useI18n();
  const form = useForm({
    schema: credentialFieldSchema,
    initialValues: {},
    handler: () => {},
    onChange: (_key, value) => props.onChange(String(value ?? "").trim()),
  });

  return (
    <form {...form.props} className="w-full max-w-sm">
      <Control
        input={form.input.token}
        password
        label={tr("swagger.credentials.label", {
          default: "Bearer token or API key",
        })}
        description={tr("swagger.credentials.description", {
          default: "Sent instead of your session. Kept until you reload.",
        })}
      />
    </form>
  );
};
