import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { SigilController } from "@/api/controllers/SigilController.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import { currentSigilsAtom } from "../../../atoms/currentSigilsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import TokenReveal from "../../shared/TokenReveal.tsx";

/**
 * What can be done to one app: rotate its token, or delete it.
 *
 * The two actions live here rather than on the project's settings page because
 * they are about this app and nothing else — that page enrols apps and lists
 * them, and duplicating per-app buttons there would give the same irreversible
 * delete two front doors.
 *
 * They are deliberately not symmetric. Rotating replaces the credential and
 * keeps everything the app has reported; deleting takes the history with it,
 * because the four aggregate tables cascade on `sigilId`. The confirmation each
 * opens is where that difference is spelled out.
 *
 * Both are owner-only server-side (`$secure` + `assertOwner`). The buttons are
 * shown to members too, matching the rest of the app's settings surfaces: the
 * server refuses and the error surfaces as a toast, rather than the UI keeping
 * a second, drift-prone copy of the authorization rules.
 */
const AppSettings = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const toaster = useToast();
  const dialog = useDialog();
  const sigilApi = useClient<SigilController>();

  const [project] = useStore(currentProjectAtom);
  const [sigil, setSigil] = useStore(currentSigilAtom);
  const [sigils, setSigils] = useStore(currentSigilsAtom);

  /** The one moment a rotated token is readable. Cleared when dismissed. */
  const [freshToken, setFreshToken] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  if (!project || !sigil) {
    return null;
  }

  const rotate = async () => {
    const confirmed = await dialog.confirm({
      title: tr("sigils.rotate.confirmTitle", { args: [sigil.name] }),
      description: tr("sigils.rotate.confirmDescription"),
      confirmLabel: tr("sigils.rotate.confirm"),
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const rotated = await sigilApi.rotateSigil({
        params: { projectId: project.id, sigilId: sigil.id },
      });
      const { token, ...resource } = rotated;
      setFreshToken(token);
      // The prefix names the credential everywhere it is shown, and rotation
      // changed it — refresh both the page's copy and the sidebar's.
      setSigil(resource);
      setSigils(sigils.map((it) => (it.id === resource.id ? resource : it)));
      toaster.success(tr("sigils.toast.rotated"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const confirmed = await dialog.confirm({
      title: tr("sigils.delete.confirmTitle", { args: [sigil.name] }),
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
      setSigils(sigils.filter((it) => it.id !== sigil.id));
      toaster.success(tr("sigils.toast.deleted"));
      // This page's subject no longer exists, so staying here would render a
      // 404 on the next load. The enrolment page is where an operator goes
      // next anyway.
      await router.push("projectSettingsSigils", {
        params: { projectId: String(project.id) },
      });
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {tr("app.settings.rotate.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground text-sm">
            {tr("app.settings.rotate.description")}
          </p>
          <Button
            variant="outline"
            disabled={busy}
            aria-label={tr("sigils.action.rotate")}
            onClick={() => void rotate()}
          >
            <RefreshCw />
            {tr("sigils.action.rotate")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {tr("app.settings.delete.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground text-sm">
            {tr("app.settings.delete.description")}
          </p>
          <Button
            variant="destructive"
            disabled={busy}
            aria-label={tr("sigils.action.delete")}
            onClick={() => void remove()}
          >
            <Trash2 />
            {tr("sigils.action.delete")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default AppSettings;
