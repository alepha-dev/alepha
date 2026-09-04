import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "@/web/app/services/I18n.ts";

import type { BulkOutcome } from "./bulkOutcome.ts";

/**
 * One toast per bulk action, and never a green one over a refusal.
 *
 * Nine deleted and one refused reads as "9 deleted" only if the refusal is
 * said out loud, so a failure makes the whole toast red and still names what
 * did land.
 *
 * Shared by the Quests table and the Epics list. It was local to the first
 * of those until the second grew a selection (feedback #2086); a second copy
 * is how the two would start reporting a half-failed bulk differently.
 * `board.bulk.failed` is deliberately the one key both use, because the
 * sentence is about the outcome and not about what was in the selection.
 */
export const useBulkReport = (): BulkReport => {
  const toaster = useToast();
  const { tr } = useI18n<I18n, "en">();

  return (outcome, done, skipped) => {
    const parts = [outcome.done.length > 0 ? done : undefined, skipped].filter(
      (it): it is string => Boolean(it),
    );
    if (outcome.failed.length > 0) {
      toaster.error(
        [
          String(
            tr("board.bulk.failed", {
              args: [String(outcome.failed.length)],
            }),
          ),
          ...parts,
        ].join(" "),
      );
      return;
    }
    toaster.success(parts.join(" "));
  };
};

/**
 * `done` is what to say about the ids that landed, already rendered, and is
 * dropped when nothing landed. `skipped` names rows the caller filtered out
 * before calling at all, which is not the same thing as a refusal.
 */
export type BulkReport = (
  outcome: BulkOutcome,
  done: string,
  skipped?: string,
) => void;
