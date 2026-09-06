import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
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
import { KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import type { SigilController } from "@/api/controllers/SigilController.ts";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import TokenReveal from "../../shared/TokenReveal.tsx";

/**
 * The instance's credential: create it, rotate it, remove it.
 *
 * **A sigil is an unlock, not an identity.** The instance exists first; this
 * section is where telemetry gets turned on for it, and Analytics, Vitals,
 * Errors and Explore appear the moment it does. An instance without one is not
 * broken - it is a deployed copy nobody wired telemetry into.
 *
 * The three controls are deliberately not symmetric, and the copy on each says
 * so:
 *
 * - **Create** mints a `sg_` token, shown once. Only offered when there is
 *   none: a second credential for one deployed copy would split its history in
 *   two, and the server answers 409 either way.
 * - **Rotate** replaces the credential and keeps everything the app reported.
 *   This is the answer to a leak.
 * - **Remove** takes the history with it, because the four analytics tables
 *   cascade on `sigilId`. There is deliberately no soft version: unlinking and
 *   keeping the row would leave a credential that still accepts ingest and that
 *   no page can reach, which is worse than the deletion.
 *
 * ⚠️ Removing a sigil leaves the INSTANCE alive. The foreign key is
 * `onDelete: "set null"`, so `app_instances.sigilId` clears itself and the
 * deployed copy stays; deleting the copy is the danger zone above this
 * section.
 *
 * Every mutation is owner-only server-side (`$secure` + `assertOwner`) - that
 * is the real gate and it does not move. The controls are disabled here for a
 * member with a tooltip, purely so nobody is walked through a destructive
 * confirmation only to be refused at the end. It is a UX hint over
 * `currentProjectMemberAtom.owner`, the same server-authoritative boolean the
 * viewer's membership row already carries, not a second authorization
 * boundary.
 */
const AppSettingsSigil = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const sigilApi = useClient<SigilController>();

  const [project] = useStore(currentProjectAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const [instance, setInstance] = useStore(currentInstanceAtom);
  const [instances, setInstances] = useStore(currentInstancesAtom);

  /**
   * The one moment a minted or rotated token is readable. Cleared when
   * dismissed; nothing can produce it again.
   */
  const [freshToken, setFreshToken] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  if (!project || !instance) {
    return null;
  }

  const isOwner = member?.owner ?? false;
  const sigil = instance.sigil;
  const label = `${instance.app}/${instance.env}`;

  /**
   * Writes one instance back into both atoms.
   *
   * The page renders from the first and the sidebar from the second, and they
   * must not disagree. `?? []` covers the sidebar's could-not-load state; this
   * page's own loader always fills it, so that branch is a type guard rather
   * than a real case.
   */
  const writeInstance = (next: typeof instance) => {
    setInstance(next);
    setInstances(
      (instances ?? []).map((it) => (it.id === next.id ? next : it)),
    );
  };

  const create = async () => {
    setBusy(true);
    try {
      const created = await sigilApi.createSigil({
        params: { projectId: project.id },
        body: { app: instance.app, env: instance.env },
      });
      setFreshToken(created.token);
      // Built field by field rather than spread: the response is a sigil
      // resource and the atom holds an instance carrying a narrower summary of
      // one, so a spread would put fields where the schema refuses them.
      writeInstance({
        ...instance,
        sigilId: created.id,
        sigil: {
          id: created.id,
          tokenPrefix: created.tokenPrefix,
          kinds: created.kinds,
          createdAt: created.createdAt,
        },
      });
      toaster.success(tr("sigils.toast.created"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!sigil) return;
    const confirmed = await dialog.confirm({
      title: tr("sigils.rotate.confirmTitle", { args: [label] }),
      description: tr("sigils.rotate.confirmDescription"),
      confirmLabel: tr("sigils.rotate.confirm"),
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const rotated = await sigilApi.rotateSigil({
        params: { projectId: project.id, sigilId: sigil.id },
      });
      setFreshToken(rotated.token);
      // The prefix names the credential everywhere it is shown, and rotation
      // changed it.
      writeInstance({
        ...instance,
        sigil: { ...sigil, tokenPrefix: rotated.tokenPrefix },
      });
      toaster.success(tr("sigils.toast.rotated"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!sigil) return;
    const confirmed = await dialog.confirm({
      title: tr("sigils.delete.confirmTitle", { args: [label] }),
      description: tr("sigils.delete.confirmDescription"),
      confirmLabel: tr("sigils.delete.confirm"),
      destructive: true,
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      await sigilApi.deleteSigil({
        params: { projectId: project.id, sigilId: sigil.id },
      });
      // ⚠️ The instance survives, with its link cleared. The four unlocked tabs
      // disappear with the credential, so the tab bar re-renders around a page
      // that is still there.
      const { sigil: _removed, sigilId: _link, ...rest } = instance;
      writeInstance(rest);
      toaster.success(tr("sigils.toast.deleted"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Wrapped in a span rather than handed to `render`: a disabled control
   * swallows the pointer events the tooltip listens for.
   */
  const ownerOnly = (control: React.ReactElement) => (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {control}
      </TooltipTrigger>
      <TooltipContent>{tr("app.settings.ownerOnly")}</TooltipContent>
    </Tooltip>
  );

  return (
    <>
      {freshToken && (
        <TokenReveal
          token={freshToken}
          title={tr("sigils.token.title")}
          copyLabel={tr("sigils.token.copy")}
          doneLabel={tr("sigils.token.done")}
          copiedMessage={tr("sigils.toast.copied")}
          onDismiss={() => setFreshToken(undefined)}
        />
      )}

      <SettingsSection
        title={tr("app.settings.credential")}
        description={
          sigil
            ? tr("app.settings.rotate.description")
            : tr("app.settings.sigil.description")
        }
      >
        {sigil ? (
          <>
            <SettingsRow
              label={tr("app.settings.rotate.title")}
              description={`${sigil.tokenPrefix}…`}
            >
              {isOwner ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  aria-label={tr("sigils.action.rotate")}
                  onClick={() => void rotate()}
                >
                  <RefreshCw />
                  {tr("sigils.action.rotate")}
                </Button>
              ) : (
                ownerOnly(
                  <Button
                    variant="outline"
                    disabled
                    aria-label={tr("sigils.action.rotate")}
                  >
                    <RefreshCw />
                    {tr("sigils.action.rotate")}
                  </Button>,
                )
              )}
            </SettingsRow>

            <SettingsRow
              label={tr("app.settings.sigil.remove.title")}
              description={tr("app.settings.sigil.remove.description")}
            >
              {isOwner ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  aria-label={tr("sigils.action.delete")}
                  onClick={() => void remove()}
                >
                  <Trash2 />
                  {tr("sigils.action.delete")}
                </Button>
              ) : (
                ownerOnly(
                  <Button
                    variant="outline"
                    disabled
                    aria-label={tr("sigils.action.delete")}
                  >
                    <Trash2 />
                    {tr("sigils.action.delete")}
                  </Button>,
                )
              )}
            </SettingsRow>
          </>
        ) : (
          <SettingsRow
            label={tr("app.settings.sigil.none")}
            description={tr("app.settings.sigil.noneDescription")}
          >
            {isOwner ? (
              <Button
                disabled={busy}
                aria-label={tr("app.settings.sigil.create")}
                onClick={() => void create()}
              >
                <KeyRound />
                {tr("app.settings.sigil.create")}
              </Button>
            ) : (
              ownerOnly(
                <Button disabled aria-label={tr("app.settings.sigil.create")}>
                  <KeyRound />
                  {tr("app.settings.sigil.create")}
                </Button>,
              )
            )}
          </SettingsRow>
        )}
      </SettingsSection>
    </>
  );
};

export default AppSettingsSigil;
