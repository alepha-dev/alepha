import { z } from "alepha";
import type {
  ApiKeyController,
  ApiKeyOptionsResponse,
  ApiKeyStatus,
} from "alepha/api/keys";
import { useClient } from "alepha/react";
import { FormValidationError, useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../core/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import { useToast } from "../core/useToast.tsx";
import { Control } from "../form/Control.tsx";

export interface ApiKeyCreateDialogProps {
  open: boolean;

  onOpenChange: (open: boolean) => void;

  /**
   * Called with the new key's plain token, the only time it exists in a
   * readable form. The caller shows it.
   */
  onCreated: (token: string) => void | Promise<void>;

  /**
   * The keys the owner already holds. A live or an expired key keeps its name
   * (revoking frees it), so a clashing name is explained before the request,
   * and an expired holder is pointed at its Rotate action rather than
   * refused with the database's words.
   */
  existingKeys?: Array<{ name: string; status: ApiKeyStatus }>;

  /**
   * One sentence on whose key this is, shown above the fields. The admin
   * surface says the key is minted for the admin's own account; the account
   * panel needs no such sentence.
   */
  ownershipNote?: string;
}

/**
 * Mint an API key: a name, an optional description, and how long it lives.
 *
 * The expiry durations and the one to preselect come from
 * `GET /api-keys/options`, never from a list in this file: the policy is
 * server-only configuration, and a capped deployment must not be offered a
 * duration it then refuses.
 *
 * One component for both surfaces that mint keys, the account panel and the
 * admin table, which differ only in {@link ApiKeyCreateDialogProps.ownershipNote}.
 */
export const ApiKeyCreateDialog = (props: ApiKeyCreateDialogProps) => {
  const api = useClient<ApiKeyController>();
  const toaster = useToast();
  const { tr } = useI18n();
  const [options, setOptions] = useState<ApiKeyOptionsResponse | undefined>();

  useEffect(() => {
    if (!props.open) {
      return;
    }
    let cancelled = false;
    (api.getApiKeyOptions() as Promise<ApiKeyOptionsResponse>)
      .then((response) => {
        if (!cancelled) {
          setOptions(response);
        }
      })
      .catch((error: any) => {
        toaster.show(
          error?.message ??
            tr("account.keys.optionsError", {
              default: "Could not load the key options",
            }),
          "danger",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [props.open]);

  // Stable on purpose: `useForm` anchors its schema at mount. The presets
  // vary with the server's answer, so they reach the select as `items`, and
  // the refusal of anything else stays the server's.
  const schema = useMemo(
    () =>
      z.object({
        name: z.text({ maxLength: 100 }),
        description: z.text({ maxLength: 500 }).optional(),
        expiresIn: z.text().optional(),
      }),
    [],
  );

  const form = useForm(
    {
      schema,
      initialValues: {
        name: "",
        description: "",
        expiresIn: options?.expiry.default,
      },
      handler: async (values) => {
        const name = values.name?.trim() ?? "";
        if (!name) {
          throw new FormValidationError({
            message: tr("account.keys.nameRequired", {
              default: "Give the key a name",
            }),
            path: "/name",
          });
        }

        const holder = props.existingKeys?.find(
          (key) => key.name === name && key.status !== "revoked",
        );
        if (holder) {
          throw new FormValidationError({
            message:
              holder.status === "expired"
                ? tr("account.keys.nameHeldByExpired", {
                    default:
                      "An expired key is already called $1. Rotate it to renew it, or choose another name.",
                    args: [name],
                  })
                : tr("account.keys.nameTaken", {
                    default: "A key is already called $1.",
                    args: [name],
                  }),
            path: "/name",
          });
        }

        try {
          const created: any = await api.createApiKey({
            body: {
              name,
              description: values.description?.trim() || undefined,
              expiresIn: values.expiresIn as never,
            },
          });
          await props.onCreated(created.token);
          props.onOpenChange(false);
        } catch (error: any) {
          toaster.show(
            error?.message ??
              tr("account.keys.createError", {
                default: "Could not create that key",
              }),
            "danger",
          );
        }
      },
    },
    [props.open, options?.expiry.default],
  );
  const state = useFormState(form, ["loading"]);

  const expiryLabel = (preset: string): string => {
    switch (preset) {
      case "7d":
        return tr("account.keys.expiry.7d", { default: "7 days" });
      case "30d":
        return tr("account.keys.expiry.30d", { default: "30 days" });
      case "60d":
        return tr("account.keys.expiry.60d", { default: "60 days" });
      case "90d":
        return tr("account.keys.expiry.90d", { default: "90 days" });
      case "180d":
        return tr("account.keys.expiry.180d", { default: "180 days" });
      case "1y":
        return tr("account.keys.expiry.1y", { default: "1 year" });
      case "never":
        return tr("account.keys.expiry.never", { default: "No expiration" });
      default:
        return preset;
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("account.keys.newTitle", { default: "New API key" })}
          </DialogTitle>
          {props.ownershipNote ? (
            <DialogDescription>{props.ownershipNote}</DialogDescription>
          ) : null}
        </DialogHeader>
        <form {...form.props} className="flex flex-col gap-4">
          <Control
            input={form.input.name}
            label={tr("account.keys.name", { default: "Name" })}
            placeholder={tr("account.keys.namePlaceholder", {
              default: "CI pipeline",
            })}
          />
          <Control
            input={form.input.description}
            label={tr("account.keys.descriptionLabel", {
              default: "Description",
            })}
            placeholder={tr("account.keys.descriptionPlaceholder", {
              default: "What uses it, and where it is stored",
            })}
          />
          <Control
            input={form.input.expiresIn}
            select
            label={tr("account.keys.expiresIn", { default: "Expires after" })}
            description={
              options && options.expiry.maxDays > 0
                ? tr("account.keys.expiryCap", {
                    default: "Keys on this server live at most $1 days.",
                    args: [String(options.expiry.maxDays)],
                  })
                : undefined
            }
            items={(options?.expiry.presets ?? []).map((preset) => ({
              value: preset,
              label: expiryLabel(preset),
            }))}
            disabled={!options}
          />
          {/* `DialogFooter`, not a hand-rolled row: the border-top, the
              tinted band and the rounded bottom live there, and they are
              what every imperative dialog (`useDialog`'s confirm and
              prompt) already looks like (feedback #P2143). */}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => props.onOpenChange(false)}
            >
              {tr("account.keys.cancel", { default: "Cancel" })}
            </Button>
            <Button type="submit" disabled={!options || state.loading}>
              {tr("account.keys.submit", { default: "Create" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
