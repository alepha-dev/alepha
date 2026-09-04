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
import { cn } from "@alepha/ui/lib/utils";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  EstateController,
  EstateResource,
} from "@/api/controllers/EstateController.ts";
import type {
  LentEstateResource,
  ProjectEstateController,
} from "@/api/controllers/ProjectEstateController.ts";
import {
  ESTATE_SLUG_MAX_LENGTH,
  ESTATE_SLUG_PATTERN,
} from "@/api/schemas/estateSlugSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsEstatesAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * What the project already holds, so the picker offers only what it does
   * not.
   */
  held: LentEstateResource[];
  /**
   * The estate as the project now sees it, plus the one cleartext copy of
   * the secret when a new estate was minted on the spot.
   */
  onAttached: (estate: LentEstateResource, secret?: string) => void;
}

type Mode = "existing" | "new";

/**
 * The two ways an estate reaches a project: pick one of the caller's own, or
 * mint a new one and lend it in the same step.
 *
 * The picker is the CALLER'S list (`listMyEstates`), never anyone else's, so
 * a project owner cannot browse other members' estates from here. And the
 * trust statement is rendered in words, naming the project and the estate,
 * before the button that grants: whoever can deploy in the project can run
 * code inside the estate owner's machine, and that is a bigger grant than a
 * checkbox labelled "attach" would suggest.
 */
const ProjectSettingsEstatesAddDialog = (
  props: ProjectSettingsEstatesAddDialogProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const estateApi = useClient<EstateController>();
  const projectEstateApi = useClient<ProjectEstateController>();
  const [project] = useStore(currentProjectAtom);

  const [mode, setMode] = useState<Mode>("existing");
  const [mine, setMine] = useState<EstateResource[] | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    estateApi
      .listMyEstates()
      .then((res) => {
        if (!cancelled) setMine(res.items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toaster.error(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, estateApi]);

  const heldIds = new Set(props.held.map((item) => item.id));
  const available = (mine ?? []).filter((item) => !heldIds.has(item.id));

  // Nothing left to lend: the only thing to offer is a new one. Derived
  // rather than stored, so it follows the list instead of lagging a render.
  const nothingToPick = mine !== undefined && available.length === 0;
  const activeMode: Mode = nothingToPick ? "new" : mode;

  const normalized = slug.trim().toLowerCase();
  const slugValid = ESTATE_SLUG_PATTERN.test(normalized);
  const showSlugError = normalized.length > 0 && !slugValid;
  const chosen = available.find((item) => item.id === selected);
  const target =
    activeMode === "existing"
      ? chosen?.slug
      : slugValid
        ? normalized
        : undefined;

  const close = (open: boolean) => {
    if (busy) return;
    if (!open) {
      setSlug("");
      setSelected(undefined);
      setMode("existing");
    }
    props.onOpenChange(open);
  };

  const submit = async () => {
    if (!project || !target) return;
    setBusy(true);
    try {
      if (activeMode === "existing" && chosen) {
        const lent = await projectEstateApi.attachEstate({
          params: { projectId: project.id },
          body: { estateId: chosen.id },
        });
        props.onAttached(lent);
        toaster.success(tr("estates.toast.attached"));
      } else {
        const minted = await projectEstateApi.createProjectEstate({
          params: { projectId: project.id },
          body: { slug: normalized },
        });
        const { secret, ...lent } = minted;
        props.onAttached(lent, secret);
        toaster.success(tr("estates.toast.created"));
      }
      setSlug("");
      setSelected(undefined);
      props.onOpenChange(false);
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!project) return null;

  return (
    <Dialog open={props.open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr("estates.add.title", { args: [project.title] })}
          </DialogTitle>
          <DialogDescription>{tr("estates.add.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            variant={activeMode === "existing" ? "default" : "outline"}
            size="sm"
            disabled={nothingToPick}
            onClick={() => setMode("existing")}
          >
            {tr("estates.add.existing")}
          </Button>
          <Button
            variant={activeMode === "new" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("new")}
          >
            {tr("estates.add.new")}
          </Button>
        </div>

        {activeMode === "existing" ? (
          <div className="flex flex-col gap-2">
            {mine === undefined && (
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            )}
            {mine !== undefined && available.length === 0 && (
              <span className="text-muted-foreground text-sm">
                {tr("estates.add.none")}
              </span>
            )}
            {available.map((item) => (
              <button
                type="button"
                key={item.id}
                data-testid="estate-pick"
                className={cn(
                  "hover:bg-muted/60 flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  selected === item.id && "border-primary bg-muted",
                )}
                onClick={() => setSelected(item.id)}
              >
                <span className="font-medium">{item.slug}</span>
                {item.label && (
                  <span className="text-muted-foreground text-xs">
                    {item.label}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Input
              value={slug}
              maxLength={ESTATE_SLUG_MAX_LENGTH}
              aria-label={tr("estates.add.slug")}
              placeholder={tr("estates.add.slugPlaceholder")}
              onChange={(event) => setSlug(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && target && !busy) void submit();
              }}
            />
            {showSlugError && (
              <span className="text-destructive text-xs">
                {tr("estates.add.invalid")}
              </span>
            )}
          </div>
        )}

        {target && (
          <div className="border-destructive/30 bg-destructive/5 flex gap-2 rounded-md border p-3">
            <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" />
            <span className="text-sm">
              {tr("estates.add.trust", { args: [project.title, target] })}
            </span>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
            {tr("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !target}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {activeMode === "existing"
              ? tr("estates.add.submit")
              : tr("estates.add.submitNew")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectSettingsEstatesAddDialog;
