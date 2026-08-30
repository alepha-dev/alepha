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
import { Label } from "@alepha/ui/components/ui/label";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { ReleaseController } from "@/api/controllers/ReleaseController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ReleaseCreateDialogProps {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Carries the tag and nothing else. `createRelease` answers with the row
   * it inserted, which has no `progress` rollup yet (nothing is attached to
   * a release that did not exist a moment ago), so it is NOT a
   * `ReleaseResource` and a caller wanting one has to refetch.
   *
   * The tag is enough for the only thing a caller does with it besides
   * refetching: a release is addressed by tag, so this is what the header
   * menu navigates to.
   */
  onCreated: (created: { tag?: string }) => void;
}

/**
 * Starting a release, on its own surface.
 *
 * It used to be a bordered row swapped into the top of the page above the
 * list, which was the one thing in Lore that created something without
 * opening anything.
 *
 * ## One field, and it stays one field
 *
 * `title` is NOT NULL at the column and defaults to the tag server-side, so
 * a release called `0.28.0` reads as `0.28.0` and the form never has to ask
 * twice. A title box that silently duplicates the tag for everyone who
 * leaves it alone is worse than no title box.
 *
 * ## A dialog, not a sheet, and why this is not the inconsistency it looks
 *
 * `EpicCreateSheet` next door is a 50vw drawer, and #1634 asked for one
 * widget across both pages. The two forms are not comparable: `EpicCreate`
 * carries a markdown editor, which is what the drawer's width is for, while
 * this asks for a single short string. Putting a markdown editor in a dialog
 * to match, or this one field in a half-screen drawer to match, both trade a
 * real regression for a consistency nobody can see (the two are never on
 * screen together).
 *
 * The rule that actually holds across the app is that the CONTAINER follows
 * the FORM: a one-field create gets a dialog, a form with an editor in it
 * gets a sheet.
 *
 * ## The error stays in here
 *
 * The two failures worth designing for are a tag already taken and a tag the
 * URL cannot carry, and both are fixed by editing the value that is already
 * typed. So the message is rendered under the field and the dialog stays
 * open holding it, rather than going to a toast that outlives the dialog it
 * describes and takes the typed tag with it when it closes.
 */
const ReleaseCreateDialog = (props: ReleaseCreateDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const releaseApi = useClient<ReleaseController>();

  const [tag, setTag] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const close = () => {
    setTag("");
    setError(undefined);
    props.onOpenChange(false);
  };

  const submit = async () => {
    const trimmed = tag.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const created = await releaseApi.createRelease({
        params: { projectId: props.projectId },
        body: { tag: trimmed },
      });
      props.onCreated(created);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("release.start")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="release-create-tag">{tr("release.create.tag")}</Label>
          <Input
            id="release-create-tag"
            value={tag}
            className="font-mono"
            placeholder={tr("release.start.tag.placeholder")}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setTag(e.currentTarget.value);
              // Clear on the next keystroke: the message described the tag
              // that was refused, and it stops being true the moment that
              // tag changes.
              if (error) setError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            // Autofocus on the field the dialog exists to fill. A dialog
            // that opens over the page and does not take the caret makes
            // every create a click plus a click.
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          {error ? (
            <p className="text-destructive text-[13px]">{error}</p>
          ) : (
            <DialogDescription>
              {tr("release.create.tag.help")}
            </DialogDescription>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            {tr("common.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || !tag.trim()}
          >
            {tr("release.create.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReleaseCreateDialog;
