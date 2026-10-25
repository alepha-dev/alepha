import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useClient, useQueryClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { OtaAdminController } from "../../ota-api/controllers/OtaAdminController.ts";
import { otaAppFormSchema } from "../schemas/otaAppFormSchema.ts";

export interface OtaAppCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Register an app with its publisher public key. The private key stays with
 * the publisher; the field refuses anything but a PKCS#1 public key.
 */
export const OtaAppCreateDialog = (props: OtaAppCreateDialogProps) => {
  const client = useClient<OtaAdminController>();
  const queries = useQueryClient();
  const { tr } = useI18n();
  const form = useForm(
    {
      schema: otaAppFormSchema,
      initialValues: { appId: "", name: "", publicKey: "" },
      handler: async (values) => {
        await client.otaCreateApp({ body: values });
        queries.invalidate(["ota-apps"]);
        props.onOpenChange(false);
      },
    },
    [client],
  );
  const state = useFormState(form);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("ota.admin.apps.createTitle", { default: "Register an app" })}
          </DialogTitle>
          <DialogDescription>
            {tr("ota.admin.apps.createHint", {
              default:
                "Paste the publisher's public key (-----BEGIN RSA PUBLIC KEY-----). Its private half stays with whoever publishes.",
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          {...form.props}
          id="ota-app-create"
          className="flex flex-col gap-4"
        >
          <Control
            input={form.input.appId}
            label={tr("ota.admin.apps.colAppId", { default: "Bundle id" })}
          />
          <Control
            input={form.input.name}
            label={tr("ota.admin.apps.colName", { default: "Name" })}
          />
          <Control
            input={form.input.publicKey}
            area
            label={tr("ota.admin.apps.publicKey", { default: "Public key" })}
          />
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="minimal"
            onClick={() => props.onOpenChange(false)}
          >
            {tr("ota.admin.cancel", { default: "Cancel" })}
          </Button>
          <Button type="submit" form="ota-app-create" loading={state.loading}>
            {tr("ota.admin.apps.createSubmit", { default: "Register" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
