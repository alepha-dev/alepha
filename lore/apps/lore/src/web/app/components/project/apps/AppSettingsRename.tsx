import {
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDialog,
  useToast,
} from "@alepha/ui";
import { SettingsRow } from "@alepha/ui/settings";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import type { AppController } from "@/api/controllers/AppController.ts";
import { useRank } from "@/web/app/components/shared/useRank.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface AppSettingsRenameProps {
  /**
   * Which half this row edits. Both go through `updateApp`, each PATCHing only
   * its own key, so saving one cannot clobber a draft of the other.
   */
  half: "app" | "env";
}

/**
 * Rename one half of the pair.
 *
 * Both halves are the URL, so a rename MOVES the page: the address in the bar
 * names a row that no longer exists under it. This redirects to the new one
 * rather than leaving a 404 behind, and writes both atoms BEFORE navigating -
 * the redirect resolves the new segments against the list, and a list that does
 * not have them yet sends the reader to a page that 404s for one frame.
 *
 * ⚠️ **A rename does not follow the deployed key**, and the copy says so.
 * `SIGIL_KEY` is `sg_<projectSlug>_<secret>`: it carries the PROJECT slug, not
 * the app name, so an enrolled copy keeps reporting through a rename with
 * nothing to redeploy. Worth stating because rotating - two rows down - has
 * exactly the opposite property.
 *
 * ⚠️ The 99-character pair bound and the 409 on a taken pair both arrive as
 * server messages naming the rule. They are rendered rather than swallowed into
 * a generic failure: the fix is editing the value that is already in the field.
 *
 * The draft is seeded once, for the reason every draft-holding row here is: re
 * seeding from the atom on every render would fight whoever is typing the
 * moment any other row on this page PATCHes and writes a fresh instance back.
 */
const AppSettingsRename = (props: AppSettingsRenameProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const router = useRouter<AppRouter>();
  const toaster = useToast();
  const dialog = useDialog();
  const appApi = useClient<AppController>();

  const [project] = useStore(currentProjectAtom);
  const [instance, setInstance] = useStore(currentInstanceAtom);
  const [instances, setInstances] = useStore(currentInstancesAtom);

  const [draft, setDraft] = useState(instance?.[props.half] ?? "");

  // A `useAction` whose handler holds the confirmation and the move (#E59,
  // #Q2329). The 99-character bound and the 409 on a taken pair arrive as
  // server messages, toasted by the root listener, with the draft left in
  // the field to fix.
  const saveAction = useAction<[], void>(
    {
      handler: async () => {
        if (!project || !instance) return;
        if (draft.trim().toLowerCase() === instance[props.half]) return;

        const confirmed = await dialog.confirm({
          title: tr("app.settings.rename.confirmTitle", {
            args: [`${instance.app}/${instance.env}`],
          }),
          description: tr("app.settings.rename.confirmDescription"),
          confirmLabel: tr("app.settings.rename.save"),
        });
        if (!confirmed) return;

        const updated = await appApi.updateApp({
          params: {
            projectId: project.id,
            app: instance.app,
            env: instance.env,
          },
          // Only this half. An absent key means "leave it alone", so this row
          // cannot write a stale copy of the other one.
          body: { [props.half]: draft.trim() },
        });

        // Both copies, before the navigation.
        setInstance(updated);
        setInstances(
          (instances ?? []).map((it) => (it.id === updated.id ? updated : it)),
        );
        // Back from the server rather than from the draft: both halves are
        // trimmed and lowercased on the way in, so what was typed and what was
        // stored are not always the same string.
        setDraft(updated[props.half]);

        await router.push("appSettings", {
          params: {
            projectSlug: project.slug,
            app: updated.app,
            env: updated.env,
          },
        });
        toaster.success(
          tr("app.settings.rename.renamed", {
            args: [`${updated.app}/${updated.env}`],
          }),
        );
      },
    },
    [
      appApi,
      project,
      instance,
      instances,
      draft,
      props.half,
      dialog,
      router,
      toaster,
      tr,
    ],
  );
  const busy = saveAction.loading;
  const save = saveAction.run;

  if (!project || !instance) {
    return null;
  }

  const isOwner = can("app:manage");
  const stored = instance[props.half];
  const changed = draft.trim().toLowerCase() !== stored;
  const isApp = props.half === "app";

  return (
    <SettingsRow
      htmlFor={`app-settings-${props.half}`}
      label={isApp ? tr("apps.create.app") : tr("apps.create.env")}
      description={
        isApp
          ? tr("app.settings.rename.appDescription")
          : tr("app.settings.rename.envDescription")
      }
    >
      {/*
        Marked, because the two rename rows are the same component twice and
        their buttons carry the same label. A page-wide `getByRole("button",
        { name: "Rename" })` cannot say which half it found.
      */}
      <div
        data-testid={`app-settings-rename-${props.half}`}
        className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
      >
        <Input
          id={`app-settings-${props.half}`}
          className="min-w-0 flex-1 sm:w-72"
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
            {tr("app.settings.rename.save")}
          </Button>
        ) : (
          // Wrapped in a span rather than handed to `render`: a disabled
          // control swallows the pointer events the tooltip listens for.
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button variant="outline" disabled>
                {tr("app.settings.rename.save")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tr("app.settings.ownerOnly")}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </SettingsRow>
  );
};

export default AppSettingsRename;
