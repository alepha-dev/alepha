import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useI18n } from "alepha/react/i18n";

import type { ReleaseCascade } from "@/api/schemas/releaseCascadeSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../shared/element/typedReference.ts";
import { useCountLabel } from "./useCountLabel.ts";

/**
 * Say out loud what setting an epic's release did to the epic's quests.
 *
 * The cascade (#Q2111) moves rows nobody named, so leaving it silent would
 * make the one thing this feature exists to stop - the epic and its quests
 * disagreeing - into something that happens invisibly in the other
 * direction. Two lines, and each is a different kind of news:
 *
 * - **What moved**, as a success line, including how many stayed behind
 *   because they name a release of their own. The cascade is a default and
 *   not an override, so those keep their placement - but the epic and they
 *   now disagree, and a reader who assumed the epic spoke for all of them
 *   should hear it from here rather than from a release count later.
 * - **What refused**, as an error line naming the quests. A quest already in
 *   a published release stays where it is while the rest of the epic
 *   follows, and the call still succeeds; without this the partial outcome
 *   reads as a clean one.
 *
 * Nothing is said when nothing happened, so an epic already coherent with
 * its quests is as quiet as a rename.
 */
export const useReleaseCascadeToast = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const count = useCountLabel();

  return (cascade?: ReleaseCascade) => {
    if (!cascade) return;

    // `moved` can be zero while `kept` is not - an epic whose every quest
    // named a release of its own - so the two halves are composed rather than
    // nested, and "0 quests followed" never has to be said.
    const lines: string[] = [];
    if (cascade.moved > 0) {
      lines.push(
        count(
          cascade.moved,
          "release.cascade.moved.one",
          "release.cascade.moved.many",
        ),
      );
    }
    if (cascade.kept > 0) {
      lines.push(
        String(tr("release.cascade.kept", { args: [String(cascade.kept)] })),
      );
    }
    if (lines.length > 0) {
      toaster.success(lines.join(" "));
    }

    if (cascade.refused.length > 0) {
      toaster.error(
        String(
          tr("release.cascade.refused", {
            args: [
              String(cascade.refused.length),
              cascade.refused
                .map((quest) => formatReference("quest", quest.shortId))
                .join(", "),
            ],
          }),
        ),
      );
    }
  };
};
