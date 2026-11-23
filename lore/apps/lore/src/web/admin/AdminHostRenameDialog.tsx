import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { AdminHostController } from "@lore/core/api";
import type { AdminHostResource } from "@lore/core/schemas";
import { useAction, useClient } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useState } from "react";

import { adminHostRenameFormSchema } from "./adminHostRenameFormSchema.ts";

export interface AdminHostRenameDialogProps {
  host: AdminHostResource | undefined;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}

/**
 * Rename a host, slug and display name, as moderation (#Q3664): the instance
 * admin's fix for an offensive or misleading name, short of deleting the
 * host. The dialog says what a slug rename can break, and shows a refusal (a
 * slug already used in the home project, a malformed one) in place.
 *
 * Literal English, like the rest of the Lore admin.
 */
const AdminHostRenameDialog = (props: AdminHostRenameDialogProps) => {
  const host = props.host;
  const toaster = useToast();
  const admin = useClient<AdminHostController>();
  const [error, setError] = useState<string | undefined>();

  const [initialValues] = useState(() => ({
    slug: host?.slug ?? "",
    label: host?.label ?? "",
  }));
  const form = useForm({
    schema: adminHostRenameFormSchema,
    initialValues,
    handler: () => undefined,
  });
  const values = useFormValues(form);

  const rename = useAction<[], void>(
    {
      handler: async () => {
        if (!host) return;
        setError(undefined);
        const result = await admin.adminRenameHost({
          params: { id: host.id },
          body: { slug: values.slug, label: values.label ?? "" },
        });
        toaster.success(`"${host.slug}" is now "${result.slug}"`);
        props.onRenamed();
        props.onOpenChange(false);
      },
      onError: (caught) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
    },
    [admin, host, values.slug, values.label],
  );

  return (
    <Dialog
      open={!!host}
      onOpenChange={(next) => {
        if (rename.loading) return;
        props.onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="admin-host-rename">
        <DialogHeader>
          <DialogTitle>Rename {host?.slug}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Control
            input={form.input.slug}
            label="Slug"
            disabled={rename.loading}
            inputProps={{ "data-testid": "admin-host-rename-slug" }}
          />
          <Control
            input={form.input.label}
            label="Display name"
            disabled={rename.loading}
            inputProps={{ "data-testid": "admin-host-rename-label" }}
          />
          <p className="text-muted-foreground text-xs">
            The slug is the host's name in URLs and in deploy configs: a config
            or a link naming the old one stops finding it. The secret, the loans
            and the machine are untouched.
          </p>
          {error && (
            <p
              className="text-destructive text-sm"
              data-testid="admin-host-rename-error"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="solid"
            intent="none"
            disabled={rename.loading}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!values.slug?.trim() || rename.loading}
            onClick={() => void rename.run()}
            data-testid="admin-host-rename-submit"
          >
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdminHostRenameDialog;
