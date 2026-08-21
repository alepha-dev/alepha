import { useClient } from "alepha/react";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import type { UserDeletionHook } from "@/api/hooks/UserDeletionHook.ts";

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
    <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <span className="text-sm">
        {count === 1
          ? "1 quest you authored will also be deleted, including if it lives in someone else's project."
          : `${count} quests you authored will also be deleted, including any in other people's projects.`}
      </span>
    </div>
  );
};

export default AccountDeleteWarning;
