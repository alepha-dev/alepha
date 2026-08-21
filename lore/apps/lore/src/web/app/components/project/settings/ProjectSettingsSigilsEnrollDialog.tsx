import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import type { SigilController } from "@/api/controllers/SigilController.ts";
import {
  APP_NAME_MAX_LENGTH,
  APP_NAME_PATTERN,
} from "@/api/schemas/appNameSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentSigilsAtom } from "@/web/app/atoms/currentSigilsAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsSigilsEnrollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Handed the one cleartext copy of the new token that will ever exist. The
   * page above shows it; nothing can produce it again.
   */
  onEnrolled: (token: string) => void;
}

/**
 * The name prompt behind the Enroll button.
 *
 * The name is the app's URL segment, so it is validated here as well as on the
 * server — not as a second boundary (the server's check is the real one) but so
 * an operator learns the rule before a round trip. Input is normalised the same
 * way the handler normalises it, and the normalised form is what gets sent:
 * typing `Lore-Staging` enrols `lore-staging` rather than being refused.
 */
const ProjectSettingsSigilsEnrollDialog = (
  props: ProjectSettingsSigilsEnrollDialogProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const sigilApi = useClient<SigilController>();
  const [project] = useStore(currentProjectAtom);
  const [sigils, setSigils] = useStore(currentSigilsAtom);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const normalized = name.trim().toLowerCase();
  const valid = APP_NAME_PATTERN.test(normalized);
  // Silent while the field is empty — a rule stated before anything is typed
  // reads as an error the operator has already made.
  const showError = normalized.length > 0 && !valid;

  const close = (open: boolean) => {
    if (busy) return;
    if (!open) setName("");
    props.onOpenChange(open);
  };

  const submit = async () => {
    if (!project || !valid) return;
    setBusy(true);
    try {
      const created = await sigilApi.createSigil({
        params: { projectId: project.id },
        body: { name: normalized },
      });
      const { token, ...resource } = created;
      setSigils([resource, ...(sigils ?? [])]);
      setName("");
      props.onOpenChange(false);
      props.onEnrolled(token);
      toaster.success(tr("sigils.toast.created"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("sigils.create.title")}</DialogTitle>
          <DialogDescription>
            {tr("sigils.create.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Input
            value={name}

            maxLength={APP_NAME_MAX_LENGTH}
            aria-label={tr("sigils.create.name")}
            placeholder={tr("sigils.create.namePlaceholder")}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && valid && !busy) void submit();
            }}
          />
          {showError && (
            <span className="text-destructive text-xs">
              {tr("sigils.create.invalid")}
            </span>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
            {tr("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !valid}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {tr("sigils.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectSettingsSigilsEnrollDialog;
