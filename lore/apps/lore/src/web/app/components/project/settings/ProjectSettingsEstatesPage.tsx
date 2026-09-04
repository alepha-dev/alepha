import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
import { useClient, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  LentEstateResource,
  ProjectEstateController,
} from "@/api/controllers/ProjectEstateController.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "@/web/app/atoms/currentProjectMemberAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import TokenReveal from "../../shared/TokenReveal.tsx";
import ProjectSettingsEstateRow from "./ProjectSettingsEstateRow.tsx";
import ProjectSettingsEstatesAddDialog from "./ProjectSettingsEstatesAddDialog.tsx";

/**
 * Where this project can deploy: the estates that have been lent to it.
 *
 * An estate belongs to a user, not to the project, so this page never
 * creates or deletes one on its own account. It lends and withdraws: "add"
 * picks one of the caller's own estates (or mints a new one and lends it in
 * the same step), and "detach" withdraws the loan. Both are owner-only
 * server-side; the button is disabled here for a non-owner with a tooltip,
 * a UX hint rather than a second authorization boundary.
 *
 * Detaching is offered to the project owner and to the estate's own owner,
 * because both are legitimate: one gives up a capability, the other withdraws
 * a loan. Neither undeploys anything, and the confirmation says so, since the
 * intuitive reading is the opposite.
 */
const ProjectSettingsEstatesPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const auth = useAuth();
  const api = useClient<ProjectEstateController>();
  const [project] = useStore(currentProjectAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const isOwner = member?.owner ?? false;

  const [items, setItems] = useState<LentEstateResource[] | undefined>();
  const [adding, setAdding] = useState(false);
  /**
   * The one moment a freshly minted secret is readable. Cleared as soon as
   * it is dismissed; nothing can show it again.
   */
  const [freshSecret, setFreshSecret] = useState<string | undefined>();

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    api
      .listProjectEstates({ params: { projectId: project.id } })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toaster.error(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project, api]);

  const detach = async (estate: LentEstateResource) => {
    if (!project) return;
    const ok = await dialog.confirm({
      title: String(tr("estates.detach.confirmTitle", { args: [estate.slug] })),
      description: String(tr("estates.detach.confirmDescription")),
      confirmLabel: String(tr("estates.detach.confirm")),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.detachEstate({
        params: { projectId: project.id, estateId: estate.id },
      });
      setItems((current) =>
        (current ?? []).filter((item) => item.id !== estate.id),
      );
      toaster.success(tr("estates.toast.detached"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

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
              {isOwner ? (
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
                    {tr("estates.project.ownerOnly")}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </CardContent>

          {items !== undefined && items.length === 0 && (
            <CardContent className="px-4 py-6">
              <span className="text-muted-foreground text-sm">
                {tr("estates.project.empty")}
              </span>
            </CardContent>
          )}
          {(items ?? []).map((estate) => (
            <ProjectSettingsEstateRow
              key={estate.id}
              estate={estate}
              canDetach={isOwner || estate.owner.id === auth.user?.id}
              onDetach={detach}
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
          if (secret) setFreshSecret(secret);
        }}
      />
    </div>
  );
};

export default ProjectSettingsEstatesPage;
