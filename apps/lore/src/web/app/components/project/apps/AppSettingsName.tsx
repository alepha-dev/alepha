import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
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
import { useState } from "react";

import type { SigilController } from "@/api/controllers/SigilController.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import { currentSigilsAtom } from "../../../atoms/currentSigilsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * Rename the app.
 *
 * The name is the app's URL segment, so a rename moves the page: the address
 * in the bar names an app that no longer exists under it. This redirects to
 * the new one rather than leaving a 404 behind, and writes both sigil atoms so
 * the page and the sidebar cannot disagree - the same pair `rotate` already
 * refreshes.
 *
 * ⚠️ **A rename does not follow the deployed key**, and the copy says so.
 * `SIGIL_KEY` is `sg_<projectSlug>_<secret>`: it carries the PROJECT slug, not
 * the app name, so an enrolled app keeps reporting through a rename with
 * nothing to redeploy. Worth stating because the action directly below it -
 * rotate - has the opposite property, and because renaming a PROJECT does
 * break every enrolled app's feedback link until each key is rotated.
 *
 * Owner-only server-side, like every other mutation on this page; the control
 * is disabled for a non-owner as a UX hint over `currentProjectMemberAtom`,
 * not as a second authorization boundary.
 */
const AppSettingsName = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const toaster = useToast();
  const dialog = useDialog();
  const sigilApi = useClient<SigilController>();

  const [project] = useStore(currentProjectAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const [sigil, setSigil] = useStore(currentSigilAtom);
  const [sigils, setSigils] = useStore(currentSigilsAtom);

  /**
   * Seeded once, for the reason `AppSettingsUrl`'s draft is: re-seeding from
   * the atom every render would fight whoever is typing the moment any other
   * card on this page PATCHes and writes a fresh sigil back.
   */
  const [draft, setDraft] = useState(sigil?.name ?? "");
  const [busy, setBusy] = useState(false);

  const isOwner = member?.owner ?? false;

  if (!project || !sigil) {
    return null;
  }

  const changed = draft.trim().toLowerCase() !== sigil.name;

  const save = async () => {
    if (!changed) {
      return;
    }

    const confirmed = await dialog.confirm({
      title: tr("app.settings.name.confirmTitle", { args: [sigil.name] }),
      description: tr("app.settings.name.confirmDescription"),
      confirmLabel: tr("app.settings.name.save"),
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const updated = await sigilApi.updateSigil({
        params: { projectId: project.id, sigilId: sigil.id },
        // Only the name. The endpoint treats an absent key as "leave it
        // alone", so this control cannot clobber the capabilities card or the
        // URL field with a stale copy of their state.
        body: { name: draft.trim() },
      });

      // Both copies, before the navigation: the page renders from the first
      // and the sidebar from the second, and a redirect that arrives before
      // either is written would resolve the new segment against a list that
      // does not have it yet.
      setSigil(updated);
      setSigils(
        (sigils ?? []).map((it) => (it.id === updated.id ? updated : it)),
      );
      // Back from the server rather than from the draft: the name is trimmed
      // and lowercased on the way in, so what was typed and what was stored
      // are not always the same string.
      setDraft(updated.name);

      // The current URL names an app that no longer exists under that
      // segment. Replacing it is the difference between a rename and a 404.
      await router.push("appSettings", {
        params: { projectSlug: project.slug, appName: updated.name },
      });
      toaster.success(
        tr("app.settings.name.renamed", { args: [updated.name] }),
      );
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {tr("app.settings.name.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">
          {tr("app.settings.name.description")}
        </p>
        <div className="flex w-full flex-wrap items-center gap-2">
          <Input
            className="min-w-0 flex-1"
            aria-label={tr("app.settings.name.title")}
            value={draft}
            disabled={!isOwner || busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void save();
              }
            }}
          />
          {isOwner ? (
            <Button
              variant="outline"
              disabled={busy || !changed}
              onClick={() => void save()}
            >
              {tr("app.settings.name.save")}
            </Button>
          ) : (
            // Wrapped in a span rather than handed to `render`: a disabled
            // control swallows the pointer events the tooltip listens for.
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button variant="outline" disabled>
                  {tr("app.settings.name.save")}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{tr("app.settings.ownerOnly")}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default AppSettingsName;
