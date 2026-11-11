import { useInject } from "alepha/react";
import { PasskeyClient, useAuth } from "alepha/react/auth";
import { useEffect } from "react";

export interface AuthPasskeyAutofillProps {
  /**
   * The realm the sign-in is for.
   */
  realm?: string;

  /**
   * Receives the controller of the running autofill ceremony (and
   * `undefined` once it is gone), so the page aborts it before a modal one:
   * two concurrent `get` calls throw.
   */
  onController: (controller: AbortController | undefined) => void;

  /**
   * Bumped by the page to start the autofill again, after a modal ceremony.
   */
  generation: number;

  onSignedIn: () => void | Promise<void>;

  onError: (error: Error) => void;
}

/**
 * Passkeys in the browser's autofill of the identifier field (conditional
 * mediation). Renders nothing: on mount, when the browser supports it, it
 * starts a conditional `get` that waits for the user to pick a passkey from
 * the field's suggestions, and aborts it on unmount.
 *
 * The identifier input must carry `webauthn` in its `autocomplete` for the
 * browser to offer them there.
 */
export const AuthPasskeyAutofill = (props: AuthPasskeyAutofillProps) => {
  const client = useInject(PasskeyClient);
  const auth = useAuth();

  useEffect(() => {
    const controller = new AbortController();
    props.onController(controller);
    void (async () => {
      if (!(await client.isAutofillSupported()) || controller.signal.aborted) {
        return;
      }
      try {
        const tokens = await auth.loginPasskey({
          realm: props.realm,
          mediation: "conditional",
          signal: controller.signal,
        });
        if (tokens && !controller.signal.aborted) {
          await props.onSignedIn();
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          props.onError(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    })();
    return () => {
      controller.abort();
      props.onController(undefined);
    };
  }, [props.generation]);

  return null;
};
