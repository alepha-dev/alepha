import {
  Button,
  Card,
  CardContent,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDialog,
  useToast,
  cn,
} from "@alepha/ui";
import { settingsCardEdge } from "@alepha/ui/settings";
import {
  currentProjectAtom,
  useRank,
  type I18n,
  TokenReveal,
} from "@lore/core/web";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useState } from "react";

import type {
  LentEstateResource,
  ProjectEstateController,
} from "../../../../../api/controllers/ProjectEstateController.ts";
import type { OwnedEstateResource } from "../../../../../api/schemas/ownedEstateResourceSchema.ts";
import ProjectSettingsEstateRow from "./ProjectSettingsEstateRow.tsx";
import ProjectSettingsEstatesAddDialog from "./ProjectSettingsEstatesAddDialog.tsx";
import ProjectSettingsHomeEstateRow from "./ProjectSettingsHomeEstateRow.tsx";

/**
 * Where this project can deploy: the estates that have been lent to it.
 *
 * An estate belongs to a user, not to the project, so this page never
 * creates or deletes one on its own account. It lends and withdraws: "add"
 * picks one of the caller's own estates (or mints a new one and lends it in
 * the same step), and "detach" withdraws the loan. Both need `estate:lend`
 * server-side; the button is disabled here for a rank without it, with a
 * tooltip, a UX hint rather than a second authorization boundary.
 *
 * Detaching is offered to a rank with `estate:lend` and to the estate's own
 * owner, because both are legitimate: one gives up a capability, the other
 * withdraws a loan. Neither undeploys anything, and the confirmation says so,
 * since the intuitive reading is the opposite.
 */
const ProjectSettingsEstatesPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const dialog = useDialog();
  const api = useClient<ProjectEstateController>();
  const [project] = useStore(currentProjectAtom);
  const canLend = can("estate:lend");

  const [items, setItems] = useState<LentEstateResource[] | undefined>();
  const [adding, setAdding] = useState(false);
  /**
   * The one moment a freshly minted secret is readable. Cleared as soon as
   * it is dismissed; nothing can show it again.
   */
  const [freshSecret, setFreshSecret] = useState<string | undefined>();

  // Local state seeded by the read, because attaching and detaching patch
  // the list in place. A failed read is toasted by the root listener.
  useQuery(
    {
      enabled: project !== undefined,
      handler: () =>
        api.listProjectEstates({
          params: { projectId: project?.id as number },
        }),
      onSuccess: (res) => setItems(res.items),
    },
    [api, project?.id],
  );

  // The estates this project is the home of (#E126), lent here or not: the
  // ones its members manage. The list above it is what it may deploy onto.
  const home = useQuery(
    {
      enabled: project !== undefined,
      key: ["project-home-estates", project?.id],
      handler: () =>
        api.listHomeEstates({ params: { projectId: project?.id as number } }),
    },
    [api, project?.id],
  );
  const homeItems = home.data?.items;
  const lentIds = new Set((items ?? []).map((item) => item.id));
  const borrowed = (items ?? []).filter((item) => !item.isHome);

  const lendAction = useAction<[estate: OwnedEstateResource], void>(
    {
      handler: async (_ctx, estate) => {
        if (!project) return;
        const lent = await api.attachEstate({
          params: { projectId: project.id },
          body: { estateId: estate.id },
        });
        setItems((current) => [lent, ...(current ?? [])]);
        await home.refetch();
        toaster.success(tr("estates.toast.attached"));
      },
    },
    [api, project, home, toaster, tr],
  );

  const detachAction = useAction<[estate: LentEstateResource], void>(
    {
      handler: async (_ctx, estate) => {
        if (!project) return;
        const ok = await dialog.confirm({
          title: tr("estates.detach.confirmTitle", { args: [estate.slug] }),
          description: tr("estates.detach.confirmDescription"),
          confirmLabel: tr("estates.detach.confirm"),
          destructive: true,
        });
        if (!ok) return;
        await api.detachEstate({
          params: { projectId: project.id, estateId: estate.id },
        });
        setItems((current) =>
          (current ?? []).filter((item) => item.id !== estate.id),
        );
        toaster.success(tr("estates.toast.detached"));
      },
    },
    [api, project, dialog, toaster, tr],
  );

  if (!project) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-sm">{tr("estates.project.title")}</span>
        <span className="text-muted-foreground text-xs">
          {tr("estates.project.description")}
        </span>

        {freshSecret && (
          <TokenReveal
            token={freshSecret}
            title={tr("estates.secret.title")}
            copyLabel={tr("estates.secret.copy")}
            doneLabel={tr("estates.secret.done")}
            copiedMessage={tr("estates.toast.copied")}
            onDismiss={() => setFreshSecret(undefined)}
          />
        )}

        <Card className={cn(settingsCardEdge, "gap-0 divide-y py-0")}>
          <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                {tr("estates.project.add")}
              </span>
              <span className="text-muted-foreground text-xs">
                {tr("estates.add.description")}
              </span>
            </div>
            <div className="flex justify-start sm:justify-end">
              {canLend ? (
                <Button onClick={() => setAdding(true)}>
                  <Plus className="size-4" />
                  {tr("estates.project.add")}
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button disabled aria-label={tr("estates.project.add")} />
                    }
                  >
                    <Plus className="size-4" />
                    {tr("estates.project.add")}
                  </TooltipTrigger>
                  <TooltipContent>
                    {tr("estates.project.notAllowed")}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </CardContent>
        </Card>

        <span className="mt-4 text-sm" data-testid="home-estates-title">
          {tr("estates.home.title")}
        </span>
        <span className="text-muted-foreground text-xs">
          {tr("estates.home.description")}
        </span>
        <Card className={cn(settingsCardEdge, "gap-0 divide-y py-0")}>
          {homeItems !== undefined && homeItems.length === 0 && (
            <CardContent className="px-4 py-6">
              <span className="text-muted-foreground text-sm">
                {tr("estates.home.empty")}
              </span>
            </CardContent>
          )}
          {(homeItems ?? []).map((estate) => (
            <ProjectSettingsHomeEstateRow
              key={estate.id}
              estate={estate}
              lentHere={lentIds.has(estate.id)}
              {...(canLend
                ? {
                    onLend: (item: OwnedEstateResource) =>
                      void lendAction.run(item),
                  }
                : {})}
              busy={lendAction.loading || detachAction.loading}
            />
          ))}
        </Card>

        <span className="mt-4 text-sm" data-testid="borrowed-estates-title">
          {tr("estates.borrowed.title")}
        </span>
        <span className="text-muted-foreground text-xs">
          {tr("estates.borrowed.description")}
        </span>
        <Card className={cn(settingsCardEdge, "gap-0 divide-y py-0")}>
          {items !== undefined && borrowed.length === 0 && (
            <CardContent className="px-4 py-6">
              <span className="text-muted-foreground text-sm">
                {tr("estates.project.empty")}
              </span>
            </CardContent>
          )}
          {borrowed.map((estate) => (
            <ProjectSettingsEstateRow
              key={estate.id}
              estate={estate}
              // Either side of the loan may end it: `estate:lend` here, or in
              // the estate's home project, which the server sends in `can`.
              canDetach={canLend || estate.can.includes("estate:lend")}
              onDetach={(item) => void detachAction.run(item)}
              busy={detachAction.loading || lendAction.loading}
            />
          ))}
        </Card>
      </div>

      <ProjectSettingsEstatesAddDialog
        open={adding}
        onOpenChange={setAdding}
        held={items ?? []}
        onAttached={(estate, secret) => {
          setItems((current) => [estate, ...(current ?? [])]);
          // A new estate is created here, its home: the group above shows it.
          void home.refetch();
          if (secret) setFreshSecret(secret);
        }}
      />
    </div>
  );
};

export default ProjectSettingsEstatesPage;
