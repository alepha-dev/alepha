import { SettingsDangerSection } from "@alepha/ui/components/settings/settings-danger-section";
import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import type { AppController } from "@/api/controllers/AppController.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * Remove this deployed copy from Lore's records.
 *
 * ⚠️ **It undeploys nothing.** The copy keeps running wherever it runs; what
 * goes is Lore's row for it, and with it the credential that row holds and
 * everything that credential reported - the four analytics tables cascade on
 * `sigilId`. Blights survive (`blights.sigilId` is `ON DELETE SET NULL`): a
 * triage decision outlives the credential that surfaced it.
 *
 * The confirmation names all of that, because the intuitive reading of
 * "delete" here is the opposite of what happens on both counts.
 *
 * Lands on the Apps list afterwards: the page's subject no longer exists, so
 * staying would render a 404 on the next load.
 */
const AppSettingsDelete = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const toaster = useToast();
  const dialog = useDialog();
  const appApi = useClient<AppController>();

  const [project] = useStore(currentProjectAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const [instance] = useStore(currentInstanceAtom);
  const [instances, setInstances] = useStore(currentInstancesAtom);
  const [busy, setBusy] = useState(false);

  if (!project || !instance) {
    return null;
  }

  const isOwner = member?.owner ?? false;
  const label = `${instance.app}/${instance.env}`;

  const remove = async () => {
    const confirmed = await dialog.confirm({
      title: tr("app.settings.delete.confirmTitle", { args: [label] }),
      description: instance.sigil
        ? tr("app.settings.delete.confirmWithSigil")
        : tr("app.settings.delete.confirmDescription"),
      confirmLabel: tr("app.settings.delete.confirm"),
      destructive: true,
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      await appApi.deleteApp({
        params: {
          projectId: project.id,
          app: instance.app,
          env: instance.env,
        },
      });
      // A new array, not a mutation: the Apps table reads this atom as static
      // data and re-renders on identity.
      setInstances((instances ?? []).filter((it) => it.id !== instance.id));
      toaster.success(tr("app.settings.delete.deleted"));
      await router.push("projectApps", {
        params: { projectSlug: project.slug },
      });
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <SettingsDangerSection title={tr("app.settings.danger")}>
      <SettingsRow
        label={tr("app.settings.delete.title")}
        description={tr("app.settings.delete.description")}
      >
        {isOwner ? (
          <Button
            variant="destructive"
            disabled={busy}
            aria-label={tr("app.settings.delete.action")}
            onClick={() => void remove()}
          >
            <Trash2 />
            {tr("app.settings.delete.action")}
          </Button>
        ) : (
          // Wrapped in a span rather than handed to `render`: a disabled
          // control swallows the pointer events the tooltip listens for.
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button
                variant="destructive"
                disabled
                aria-label={tr("app.settings.delete.action")}
              >
                <Trash2 />
                {tr("app.settings.delete.action")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tr("app.settings.ownerOnly")}</TooltipContent>
          </Tooltip>
        )}
      </SettingsRow>
    </SettingsDangerSection>
  );
};

export default AppSettingsDelete;
