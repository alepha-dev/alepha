import type { MyPasskeyController, PasskeyProof } from "alepha/api/users";
import { type RunResult, useAction, useClient, useInject } from "alepha/react";
import { PasskeyClient, useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import type { AuthenticationResponseJson } from "alepha/security";
import { useCallback } from "react";

/**
 * The query key of the caller's passkey list.
 */
export const ACCOUNT_PASSKEYS_KEY = ["account-passkeys"];

/**
 * Passkeys from React: add one, remove one, prove with one, sign in with
 * one. Each verb returns a `RunResult`, `reason: "cancelled"` when the user
 * dismissed the browser's prompt (quiet: no toast, nothing written).
 *
 * The browser API is {@link PasskeyClient}'s, so a spec substitutes it;
 * the routes are `MyPasskeyController`'s and `useAuth().loginPasskey`.
 */
export const usePasskey = (
  options: {
    /**
     * Handle a failed add or removal here instead of the app's toaster: for
     * a dialog that shows the error itself (a wrong password on its field).
     */
    onError?: (error: Error) => void;
  } = {},
) => {
  const api = useClient<MyPasskeyController>();
  const client = useInject(PasskeyClient);
  const auth = useAuth();
  const { tr } = useI18n();

  const registerAction = useAction<
    [proof: PasskeyProof | undefined, name: string],
    boolean
  >(
    {
      handler: async (_ctx, proof, name) => {
        const options = await api.createMyPasskeyOptions();
        const ceremony = await client.create(options);
        if (!ceremony.ok) {
          if (ceremony.reason === "cancelled") {
            return false;
          }
          throw ceremony.reason === "exists"
            ? new Error(
                tr("passkey.alreadyRegistered", {
                  default:
                    "This device already holds a passkey for this account.",
                }),
              )
            : (ceremony.error ??
                new Error(
                  tr("passkey.unsupported", {
                    default: "This browser cannot use passkeys.",
                  }),
                ));
        }
        await api.createMyPasskey({
          body: { credential: ceremony.value, name, proof },
        });
        return true;
      },
      invalidates: [ACCOUNT_PASSKEYS_KEY],
      ...(options.onError ? { onError: options.onError } : {}),
    },
    [api, client, tr, options.onError],
  );

  const removeAction = useAction<
    [id: string, proof: PasskeyProof | undefined],
    boolean
  >(
    {
      handler: async (_ctx, id, proof) => {
        await api.deleteMyPasskey({ params: { id }, body: { proof } });
        return true;
      },
      invalidates: [ACCOUNT_PASSKEYS_KEY],
      ...(options.onError ? { onError: options.onError } : {}),
    },
    [api, options.onError],
  );

  const proveAction = useAction<[], AuthenticationResponseJson | undefined>(
    {
      handler: async () => {
        const options = await api.createMyPasskeyProofOptions();
        const ceremony = await client.get(options);
        if (!ceremony.ok) {
          if (ceremony.reason === "cancelled") {
            return undefined;
          }
          throw ceremony.error ?? new Error(ceremony.reason);
        }
        return ceremony.value;
      },
    },
    [api, client],
  );

  const signInAction = useAction<
    [options: { challenge?: string; realm?: string }],
    boolean
  >(
    {
      handler: async (_ctx, options) =>
        (await auth.loginPasskey(options)) !== undefined,
    },
    [auth],
  );

  const cancelledIfFalse = <T>(result: RunResult<T>): RunResult<T> =>
    result.ok && (result.value === false || result.value === undefined)
      ? { ok: false, reason: "cancelled" }
      : result;

  return {
    /**
     * Whether this browser can run a passkey ceremony at all.
     */
    supported: client.isSupported(),
    register: useCallback(
      async (proof: PasskeyProof | undefined, name: string) =>
        cancelledIfFalse(await registerAction.run(proof, name)),
      [registerAction.run],
    ),
    remove: useCallback(
      async (id: string, proof: PasskeyProof | undefined) =>
        cancelledIfFalse(await removeAction.run(id, proof)),
      [removeAction.run],
    ),
    /**
     * A step-up assertion from one of the account's passkeys, for the
     * `proof.assertion` of an add or a removal.
     */
    prove: useCallback(
      async () => cancelledIfFalse(await proveAction.run()),
      [proveAction.run],
    ),
    signIn: useCallback(
      async (options: { challenge?: string; realm?: string } = {}) =>
        cancelledIfFalse(await signInAction.run(options)),
      [signInAction.run],
    ),
    loading:
      registerAction.loading ||
      removeAction.loading ||
      proveAction.loading ||
      signInAction.loading,
  };
};
