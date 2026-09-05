import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import type { EstateController } from "@/api/controllers/EstateController.ts";
import type { UserDeletionHook } from "@/api/hooks/UserDeletionHook.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * What deleting a Lore account costs beyond the account itself.
 *
 * Fills `AccountSecurityProps.deleteWarning`, so it renders inside the
 * framework's delete dialog above the confirmation field. The framework can
 * say what happens to users, identities and sessions; only Lore knows that
 * `quests.createdBy` is `onDelete: "cascade"`, which means every quest this
 * account authored goes with it — **including quests inside projects
 * belonging to other people** — and that `estates.ownerUserId` cascades
 * too, so every estate the account owns is deleted, its secret revoked, and
 * every project it was lent to loses a deploy destination (#1838).
 *
 * `UserDeletionHook` deliberately does not refuse on either (refusing would
 * make deletion impossible for any active collaborator, and an estate
 * deletion must not be blockable by other people's projects), so saying the
 * numbers out loud, before the click, is the only thing between the person
 * and a surprise they cannot undo.
 *
 * Renders nothing while the counts are loading or all zero: an empty warning
 * box is worse than none, and "0 quests" is not a consequence. The two
 * counts fail independently: a failed one must not block the dialog, and
 * must not hide the other.
 */
const AccountDeleteWarning = () => {
  const api = useClient<UserDeletionHook>();
  const estateApi = useClient<EstateController>();
  const { tr } = useI18n<I18n, "en">();
  const [count, setCount] = useState<number | undefined>();
  const [estates, setEstates] = useState<
    { estates: number; projects: number } | undefined
  >();

  useEffect(() => {
    let cancelled = false;
    api
      .countMyAuthoredQuests()
      .then((result) => {
        if (!cancelled) {
          setCount(result.count);
        }
      })
      // A failed count must not block the dialog — the deletion itself is
      // still gated by the hook and the confirmation phrase.
      .catch(() => undefined);
    estateApi
      .countMyEstates()
      .then((result) => {
        if (!cancelled) {
          setEstates(result);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, estateApi]);

  const lines: string[] = [];
  if (count) {
    lines.push(
      String(
        count === 1
          ? tr("account.delete.quests.one")
          : tr("account.delete.quests.many", { args: [String(count)] }),
      ),
    );
  }
  if (estates?.estates) {
    lines.push(
      String(
        estates.estates === 1
          ? tr("account.delete.estates.one", {
              args: [String(estates.projects)],
            })
          : tr("account.delete.estates.many", {
              args: [String(estates.estates), String(estates.projects)],
            }),
      ),
    );
  }

  if (lines.length === 0) {
    return null;
  }

  return (
    <div className="border-destructive/30 bg-destructive/5 flex flex-col gap-2 rounded-md border p-3">
      {lines.map((line) => (
        <span key={line} className="flex gap-2 text-sm">
          <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" />
          <span>{line}</span>
        </span>
      ))}
    </div>
  );
};

export default AccountDeleteWarning;
