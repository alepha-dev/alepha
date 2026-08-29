import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

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
 * belonging to other people**.
 *
 * `UserDeletionHook` deliberately does not refuse on those (refusing would
 * make deletion impossible for any active collaborator), so saying the number
 * out loud, before the click, is the only thing between the person and a
 * surprise they cannot undo.
 *
 * Renders nothing while the count is loading or zero: an empty warning box is
 * worse than none, and "0 quests" is not a consequence.
 */
const AccountDeleteWarning = () => {
  const api = useClient<UserDeletionHook>();
  const { tr } = useI18n<I18n, "en">();
  const [count, setCount] = useState<number | undefined>();

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
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (!count) {
    return null;
  }

  return (
    <div className="border-destructive/30 bg-destructive/5 flex gap-2 rounded-md border p-3">
      <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" />
      <span className="text-sm">
        {count === 1
          ? tr("account.delete.quests.one")
          : tr("account.delete.quests.many", { args: [String(count)] })}
      </span>
    </div>
  );
};

export default AccountDeleteWarning;
