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
import type { OtaAppResource } from "../../ota-api/schemas/otaAppResourceSchema.ts";
import { otaUploadFormSchema } from "../schemas/otaUploadFormSchema.ts";

export interface OtaUploadDialogProps {
  app: OtaAppResource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Publish what `alepha capacitor release --dry-run` wrote: the encrypted
 * bundle and its manifest. The browser never signs anything and never holds
 * a private key; the server checks the bundle against the app's public key.
 */
export const OtaUploadDialog = (props: OtaUploadDialogProps) => {
  const client = useClient<OtaAdminController>();
  const queries = useQueryClient();
  const { tr } = useI18n();
  const form = useForm(
    {
      schema: otaUploadFormSchema,
      handler: async (values) => {
        await client.otaUploadBundle({ body: values });
        queries.invalidate(["ota-bundles", props.app.id]);
        queries.invalidate(["ota-channels", props.app.id]);
        props.onOpenChange(false);
      },
    },
    [client, props.app.id],
  );
  const state = useFormState(form);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("ota.admin.bundles.upload", { default: "Upload a release" })}
          </DialogTitle>
          <DialogDescription>
            {tr("ota.admin.bundles.uploadHint", {
              default:
                "The two files alepha capacitor release --dry-run writes: the manifest (.json) and the encrypted bundle (.zip). A raw ZIP is refused.",
            })}
          </DialogDescription>
        </DialogHeader>
        <form {...form.props} id="ota-upload" className="flex flex-col gap-4">
          <Control
            input={form.input.manifest}
            file
            label={tr("ota.admin.bundles.manifest", { default: "Manifest" })}
          />
          <Control
            input={form.input.bundle}
            file
            label={tr("ota.admin.bundles.bundle", {
              default: "Encrypted bundle",
            })}
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
          <Button type="submit" form="ota-upload" loading={state.loading}>
            {tr("ota.admin.bundles.publish", { default: "Publish" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
