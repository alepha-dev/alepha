import { SettingsHeading } from "@alepha/ui/components/settings/settings-heading";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import type { EstateController } from "@/api/controllers/EstateController.ts";
import {
  ESTATE_SLUG_MAX_LENGTH,
  ESTATE_SLUG_PATTERN,
} from "@/api/schemas/estateSlugSchema.ts";
import type { OwnedEstateResource } from "@/api/schemas/ownedEstateResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import TokenReveal from "../shared/TokenReveal.tsx";
import MyEstateCard from "./MyEstateCard.tsx";

/**
 * The estates the signed-in user owns, across every project (#1838).
 *
 * An estate is personal: it is created here or from inside a project, and
 * lent to projects from their settings. This page is where the owner sees
 * all of them at once, with the switches and the secret, which no project
 * page shows because neither belongs to a project.
 *
 * Every action here is also enforced server-side on the row's owner
 * (`EstateService.loadOwned` answers 404 for anyone else); the page only
 * decides what to draw.
 *
 * A freshly minted secret, at creation or rotation, is shown once at the
 * top of the page and nowhere else. The column stores a hash, so dismissing
 * it is final.
 */
const MyEstates = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<EstateController>();

  const [items, setItems] = useState<OwnedEstateResource[] | undefined>();
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    api
      .listMyEstates()
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
  }, [api]);

  const normalized = slug.trim().toLowerCase();
  const slugValid = ESTATE_SLUG_PATTERN.test(normalized);
  const showSlugError = normalized.length > 0 && !slugValid;

  const create = async () => {
    if (!slugValid || busy) return;
    setBusy(true);
    try {
      const minted = await api.createEstate({ body: { slug: normalized } });
      const { secret, ...estate } = minted;
      setItems((current) => [{ ...estate, projects: [] }, ...(current ?? [])]);
      setFreshSecret(secret);
      setSlug("");
      toaster.success(tr("account.estates.toast.created"));
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeading
        title={String(tr("account.estates.title"))}
        description={String(tr("account.estates.description"))}
      />

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

      <Card className="gap-0 py-0">
        <CardContent className="flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {tr("account.estates.create")}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr("account.estates.create.description")}
            </span>
          </div>
          <form
            className="flex items-start gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <div className="flex flex-col gap-1">
              <Input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder={tr("estates.add.slugPlaceholder")}
                maxLength={ESTATE_SLUG_MAX_LENGTH}
                aria-label={tr("estates.add.slug")}
                aria-invalid={showSlugError || undefined}
                data-testid="estate-create-slug"
                className="w-48"
              />
              {showSlugError && (
                <span className="text-destructive text-xs">
                  {tr("estates.add.invalid")}
                </span>
              )}
            </div>
            <Button
              type="submit"
              disabled={!slugValid || busy}
              data-testid="estate-create-submit"
            >
              <Plus className="size-4" />
              {tr("account.estates.create.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {items !== undefined && items.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {tr("account.estates.empty")}
        </p>
      )}

      {(items ?? []).map((estate) => (
        <MyEstateCard
          key={estate.id}
          estate={estate}
          onChanged={(updated) =>
            setItems((current) =>
              (current ?? []).map((item) =>
                item.id === updated.id ? updated : item,
              ),
            )
          }
          onDeleted={(id) =>
            setItems((current) =>
              (current ?? []).filter((item) => item.id !== id),
            )
          }
          onSecret={setFreshSecret}
        />
      ))}
    </div>
  );
};

export default MyEstates;
