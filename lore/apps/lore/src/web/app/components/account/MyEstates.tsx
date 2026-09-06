import { SettingsHeading } from "@alepha/ui/components/settings/settings-heading";
import { Button } from "@alepha/ui/components/ui/button";
import { Card } from "@alepha/ui/components/ui/card";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import type { EstateController } from "@/api/controllers/EstateController.ts";
import type { CreateEstateBody } from "@/api/schemas/createEstateBodySchema.ts";
import type { OwnedEstateResource } from "@/api/schemas/ownedEstateResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import MyEstateCreateDialog from "./MyEstateCreateDialog.tsx";
import MyEstateDrawer from "./MyEstateDrawer.tsx";
import MyEstateRow from "./MyEstateRow.tsx";
import MyEstateSecretDialog from "./MyEstateSecretDialog.tsx";

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
 * ## The shape, and why it changed
 *
 * A list of compact rows, a create dialog, a detail drawer, and the secret in
 * a dialog of its own - the shape `@alepha/ui`'s `account-keys.tsx` already
 * uses, adopted here for feedback #2110 and #2109 together.
 *
 * It was: an always-present create card, then one fully expanded card per
 * estate carrying the switches, the interval, the loans, the commands and
 * both destructive actions. Readable with one estate; unusable with three.
 *
 * ⚠️ The two reports are one change, not two. A freshly minted secret used to
 * appear in a card at the top of THIS page - a page that re-renders on every
 * switch in every estate below it. `estates.secretHash` stores a hash, so a
 * credential that scrolls out of view is gone, and the only way back is a
 * rotation that invalidates the machine already using it. Moving the reveal
 * into a dialog only works if the create form leaves the page too, or the
 * dialog opens behind the form that spawned it.
 *
 * Creation and rotation both mint, so both land in the same
 * {@link MyEstateSecretDialog}. `freshSecret` lives here rather than in the
 * drawer for that reason: the drawer is where a rotation starts, and it can
 * be closed.
 */
const MyEstates = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<EstateController>();

  const [items, setItems] = useState<OwnedEstateResource[] | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | undefined>();
  const [openId, setOpenId] = useState<string | undefined>();

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

  // Resolved from the list rather than held as its own copy, so a switch
  // saved in the drawer redraws it from the same row the list shows.
  const open = (items ?? []).find((item) => item.id === openId);

  /**
   * Rethrows rather than reporting: the dialog stays open and renders a
   * refusal beside the field it concerns, which a toast cannot do and which
   * is the whole point of checking the token before the row exists (#1630).
   */
  const create = async (body: CreateEstateBody) => {
    const minted = await api.createEstate({ body });
    const { secret, ...estate } = minted;
    setItems((current) => [{ ...estate, projects: [] }, ...(current ?? [])]);
    setCreateOpen(false);
    // Present only when Lore minted one, so a cloudflare create leaves the
    // reveal dialog shut because the FIELD is absent, not because an empty
    // string happens to be falsy.
    if (secret) {
      setFreshSecret(secret);
    }
    toaster.success(tr("account.estates.toast.created"));
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeading
        title={String(tr("account.estates.title"))}
        description={String(tr("account.estates.description"))}
      />

      {items !== undefined && items.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {tr("account.estates.empty")}
        </p>
      )}

      {(items ?? []).length > 0 && (
        <Card className="gap-0 divide-y overflow-hidden py-0">
          {(items ?? []).map((estate) => (
            <MyEstateRow
              key={estate.id}
              estate={estate}
              onOpen={() => setOpenId(estate.id)}
            />
          ))}
        </Card>
      )}

      <div>
        <Button
          variant="secondary"
          onClick={() => setCreateOpen(true)}
          data-testid="estate-create-open"
        >
          <Plus className="size-4" />
          {/* "New estate" here, "Create" on the dialog's submit: the page
              button opens a form, it does not perform the action. Same split
              `account-keys.tsx` makes between "New key" and "Create". */}
          {tr("account.estates.new")}
        </Button>
      </div>

      <MyEstateCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={create}
      />

      <MyEstateDrawer
        estate={open}
        onOpenChange={(next) => {
          if (!next) setOpenId(undefined);
        }}
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

      <MyEstateSecretDialog
        secret={freshSecret}
        onDismiss={() => setFreshSecret(undefined)}
      />
    </div>
  );
};

export default MyEstates;
