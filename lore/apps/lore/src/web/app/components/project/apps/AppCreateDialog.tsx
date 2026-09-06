import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Label } from "@alepha/ui/components/ui/label";
import { z } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AppController } from "@/api/controllers/AppController.ts";
import type { SigilController } from "@/api/controllers/SigilController.ts";
import { APP_NAME_MAX_LENGTH } from "@/api/schemas/appNameSchema.ts";

import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import TokenReveal from "../../shared/TokenReveal.tsx";

export interface AppCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The instance that was created, once the dialog is done with it. Fired
   * AFTER the token panel is dismissed when one was minted, so a caller that
   * navigates cannot take the one readable copy of the token off screen.
   */
  onCreated: (created: { app: string; env: string }) => void;
}

/**
 * The one dialog that creates a deployed copy, mounted from the header's
 * create menu, from the Apps list's toolbar and from its empty state.
 *
 * **It creates an instance, not an app.** Both names are required and nothing
 * is minted: there is no `apps` table, so there is no such thing as creating an
 * app on its own, and a credential is an unlock added afterwards.
 *
 * ## Why the app field is a combobox and the env field is not
 *
 * The one real cost of having no `apps` table is that a typo silently creates a
 * second app: `club` and `clbu` are two apps and nothing complains. Offering
 * the names that already exist is the whole mitigation, and `createNewEntry`
 * makes starting a new one an explicit row rather than the default. The
 * environment has no such list worth offering - every instance of an app has a
 * different one by construction - so it stays a text field.
 *
 * Both are normalised the way the server normalises them (trim, lowercase) and
 * checked against `APP_NAME_PATTERN` before the round trip, so an operator
 * learns the rule without paying for a request. The server's check is the real
 * one.
 *
 * ## The sigil checkbox is a shortcut, never a step
 *
 * Off by default, and it must stay that way: a required credential at creation
 * is the model this epic removed. When it is ticked the dialog composes the two
 * calls itself - `createApp`, then `createSigil` - and shows the token INSIDE
 * the dialog before closing. The token exists in cleartext exactly once, and
 * carrying it across a navigation is a second place to lose it.
 *
 * ## ⚠️ It writes a new array into `currentInstancesAtom`
 *
 * `ProjectApps` runs `AlephaTable` in static-data mode over that atom, where
 * `refresh()` re-fires nothing. A dialog that creates a row and does not hand
 * the table a new array leaves it invisible until a reload, which reads as a
 * broken create.
 */
const AppCreateDialog = (props: AppCreateDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const appApi = useClient<AppController>();
  const sigilApi = useClient<SigilController>();

  const [project] = useStore(currentProjectAtom);
  const [instances, setInstances] = useStore(currentInstancesAtom);

  const [error, setError] = useState<string>();
  const [withSigil, setWithSigil] = useState(false);
  /**
   * The one moment a minted token is readable. While it is set the dialog
   * stays open showing it, and `onCreated` has not fired yet.
   */
  const [freshToken, setFreshToken] = useState<string | undefined>();
  const [created, setCreated] = useState<{ app: string; env: string }>();

  /**
   * The distinct app names, from the rows the project loader already fetched.
   *
   * Derived here rather than read from `listApps`'s own `apps` array because
   * the atom is what the page holds; the two cannot differ, since the server
   * computes its array from the same rows.
   */
  const apps = [...new Set((instances ?? []).map((it) => it.app))].sort();

  const form = useForm({
    id: "app-create",
    schema: z.object({
      app: z.string().min(1).max(APP_NAME_MAX_LENGTH),
      env: z.string().min(1).max(APP_NAME_MAX_LENGTH),
    }),
    initialValues: { app: "", env: "production" },
    handler: async (input) => {
      if (!project) return;
      const app = input.app.trim().toLowerCase();
      const env = input.env.trim().toLowerCase();
      setError(undefined);

      try {
        const instance = await appApi.createApp({
          params: { projectId: project.id },
          body: { app, env },
        });
        // A new array, not a mutation: the table reads this atom as static
        // data and re-renders on identity.
        setInstances([...(instances ?? []), instance]);
        setCreated({ app: instance.app, env: instance.env });

        if (!withSigil) {
          finish({ app: instance.app, env: instance.env });
          return;
        }

        const minted = await sigilApi.createSigil({
          params: { projectId: project.id },
          body: { app: instance.app, env: instance.env },
        });
        setInstances([
          ...(instances ?? []),
          {
            ...instance,
            sigilId: minted.id,
            sigil: {
              id: minted.id,
              tokenPrefix: minted.tokenPrefix,
              kinds: minted.kinds,
              createdAt: minted.createdAt,
            },
          },
        ]);
        // The dialog stays open on the token. `finish` runs when it is
        // dismissed.
        setFreshToken(minted.token);
      } catch (err) {
        // ⚠️ The message stays in the dialog rather than going to a toast. The
        // two failures worth designing for - a pair that already exists and a
        // name the URL cannot carry - are both fixed by editing a value that is
        // already typed, and a toast outlives the dialog it describes.
        setError(err instanceof Error ? err.message : String(err));
      }
    },
  });

  const { loading: submitting } = useFormState(form, ["loading"]);

  const finish = (instance: { app: string; env: string }) => {
    setError(undefined);
    setWithSigil(false);
    setFreshToken(undefined);
    setCreated(undefined);
    props.onOpenChange(false);
    props.onCreated(instance);
  };

  const close = (open: boolean) => {
    if (open) return;
    // Dismissing while the token is on screen still counts as done: the
    // instance exists, and the panel's own copy button is the only way to keep
    // the token.
    if (created) {
      finish(created);
      return;
    }
    setError(undefined);
    setWithSigil(false);
    props.onOpenChange(false);
  };

  if (!project) {
    return null;
  }

  return (
    <Dialog open={props.open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("apps.create.title")}</DialogTitle>
          <DialogDescription>{tr("apps.create.description")}</DialogDescription>
        </DialogHeader>

        {freshToken ? (
          <TokenReveal
            token={freshToken}
            title={tr("sigils.token.title")}
            copyLabel={tr("sigils.token.copy")}
            doneLabel={tr("sigils.token.done")}
            copiedMessage={tr("sigils.toast.copied")}
            onDismiss={() => created && finish(created)}
          />
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void form.submit();
            }}
          >
            <Control
              input={form.input.app}
              label={tr("apps.create.app")}
              description={tr("apps.create.appDescription")}
              items={apps}
              // The explicit "create new" row. Without it the field would
              // either refuse a first app or accept any typo as a new one.
              createNewEntry
            />
            <Control
              input={form.input.env}
              label={tr("apps.create.env")}
              description={tr("apps.create.envDescription")}
            />

            <Label className="flex items-start gap-2 font-normal">
              <Checkbox
                checked={withSigil}
                onCheckedChange={(value) => setWithSigil(value === true)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm">{tr("apps.create.withSigil")}</span>
                <span className="text-muted-foreground text-xs">
                  {tr("apps.create.withSigilDescription")}
                </span>
              </span>
            </Label>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => close(false)}
              >
                {tr("apps.create.cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {tr("apps.create.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AppCreateDialog;
