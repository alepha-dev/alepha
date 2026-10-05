import { useInject } from "alepha/react";
import { TriangleAlert } from "lucide-react";

import { AccountDeletionRegistry } from "@/web/app/registries/AccountDeletionRegistry.ts";

/**
 * What deleting a Lore account costs beyond the account itself.
 *
 * Fills `AccountSecurityProps.deleteWarning`, so it renders inside the
 * framework's delete dialog above the confirmation field. The framework can
 * say what happens to users, identities and sessions; only Lore's modules
 * know the rest, and each registers its own line on `AccountDeletionRegistry`
 * (#E75, #Q2624). `quests.createdBy` is `onDelete: "cascade"`, which means every quest this
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
  const warnings = useInject(AccountDeletionRegistry).warnings();

  // One hook per registered warning, legal because the registry is frozen
  // before the first render. Each fails on its own, quietly: a failed count
  // must not block the dialog or add a toast over it, since the deletion
  // itself is still gated by the hook and the confirmation phrase.
  const lines = warnings
    .map((warning) => warning.useLine())
    .filter((line): line is string => !!line);

  if (lines.length === 0) {
    return null;
  }

  return (
    <div className="border-danger/30 bg-danger/5 flex flex-col gap-2 rounded-md border p-3">
      {lines.map((line) => (
        <span key={line} className="flex gap-2 text-sm">
          <TriangleAlert className="text-danger-text mt-0.5 size-4 shrink-0" />
          <span>{line}</span>
        </span>
      ))}
    </div>
  );
};

export default AccountDeleteWarning;
