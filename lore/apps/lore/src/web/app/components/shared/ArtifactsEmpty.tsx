import { useI18n } from "alepha/react/i18n";

import { loreDocsUrl } from "@/web/app/services/docsUrl.ts";

import type { I18n } from "../../services/I18n.ts";

export interface ArtifactsEmptyProps {
  /**
   * Why this particular surface is empty, already localized.
   *
   * A sentence rather than a key, because the two callers answer different
   * questions: the project page says artifacts arrive from CI, and an app's
   * own tab says everything else on it came from the app itself. The caller
   * knows which one it is; this component does not need to.
   */
  description: string;
}

/**
 * What an artifact list renders before anything has ever been pushed.
 *
 * ## It is a link now, not a tutorial
 *
 * This used to print the two commands, an `<app>` placeholder and a footnote
 * naming `LORE_API_KEY` and the `latest` rule. Feedback #P2154 asked for the
 * shape every other empty state has - icon, title, description, one link -
 * and stated the rule behind it, which is wider than this panel: **a link to
 * Lore's docs beats instructional text in the app.** Take that as the default
 * for the next empty state tempted to explain a pipeline.
 *
 * The instructions did not disappear, they moved to `guides-artifacts`, where
 * they can say the whole thing: every flag, the CI snippet, and why `latest`
 * is the one tag that may be replaced. The panel had room for none of that
 * and was already at the length nobody reads.
 *
 * The icon and the title come from whatever frames this. On the project page
 * that is `AlephaTable`'s own `emptyState`; on an app's tab it is the card
 * header above it. Rendering either here would double one of them.
 *
 * ## ⚠️ One component, where there were two
 *
 * `ProjectArtifactsEmpty` and `AppArtifactsEmpty` were deliberately separate,
 * and the reason was the command: one page spans every app so its command
 * carried a placeholder, the other names its app. Merging them then would
 * have meant a prop that is sometimes a real app name and sometimes a
 * stand-in, which is how you ship a copy-pasteable command that does not
 * work.
 *
 * That reason left with the command block. What remained was one sentence of
 * difference, which is a prop, and a docs slug that had to stay identical in
 * two files - the kind of duplication that goes wrong silently, since a wrong
 * slug 404s only for the reader who is already stuck (feedback #P2142).
 */
const ArtifactsEmpty = (props: ArtifactsEmptyProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    /*
     * ⚠️ No alignment of its own, deliberately. It carried `items-start` and
     * `text-left`, and the comment that justified them was on the `pre` this
     * replaced: the shared empty state is centred, and a command wrapped over
     * three centred lines is harder to read than the scrolling one it came
     * from. That was true of a command block. It is not true of one sentence
     * and a link, and the classes outlived the reason exactly the way the two
     * components this merged did (feedback #P2156).
     *
     * The two callers are framed differently and both are right:
     * `ProjectArtifacts` hands this to `AlephaTable`'s empty state, which is
     * `items-center text-center`; `AppArtifactsList` renders it in a card
     * under a left-aligned header, beside left-aligned loading and error
     * lines. So this declares neither and inherits both.
     *
     * `items-start` had to go with `text-left` rather than instead of it: a
     * flex column left-packs its children whatever the text alignment, which
     * would have left the link hard left under a centred sentence.
     */
    <div className="flex flex-col gap-2 py-2">
      {/*
        ⚠️ No `max-w-prose`. It is a width, not an alignment, and inside the
        centred frame it is the one that breaks: a block with a max-width in a
        flex column packs to the START, so the sentence would have been
        centred inside a box sitting off to the left. The table's own empty
        state already caps its description at `max-w-xs`, and the card on the
        app tab is the width it should be.
      */}
      <p className="text-muted-foreground text-sm">{props.description}</p>

      <a
        // ⚠️ Absolute, through `loreDocsUrl`. Written root-relative it
        // resolves against Lore's own origin and 404s (feedback #P2142).
        href={loreDocsUrl("guides-artifacts")}
        target="_blank"
        rel="noreferrer"
        className="text-sm underline underline-offset-4"
        data-testid="artifacts-empty-docs"
      >
        {tr("artifacts.empty.docs")}
      </a>
    </div>
  );
};

export default ArtifactsEmpty;
