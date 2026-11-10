import { loreDocsUrl, type I18n, OutboundLink } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

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
 * that is `DataTable`'s own `emptyState`; on an app's tab it is the card
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
     * `ProjectArtifacts` hands this to `DataTable`'s empty state, which is
     * `items-center text-center`; `AppArtifactsList` renders it in a card
     * under a left-aligned header, beside left-aligned loading and error
     * lines. So this declares neither and inherits both.
     *
     * ⚠️ A plain block, not a flex column. A flex column left-packs its
     * children whatever the text alignment, which is how the link ended up
     * hard left under a centred sentence (#Q3266): the sentence, being text,
     * inherited `text-center`, and the link, being a flex item, did not.
     * Block children inherit alignment and nothing else decides it.
     */
    <div className="py-2">
      {/*
        ⚠️ No `max-w-prose`. It is a width, not an alignment, and inside the
        centred frame it is the one that breaks: a block with a max-width
        sits at the START of its line, so the sentence would have been
        centred inside a box sitting off to the left. The table's own empty
        state already caps its description at `max-w-xs`, and the card on the
        app tab is the width it should be.
      */}
      <p className="text-muted-foreground text-sm">{props.description}</p>

      {/*
        In a paragraph of its own, which is what makes it follow the frame
        (#Q3266). `OutboundLink` is `inline-flex`: as the direct child of a
        flex column it was blockified into a full-width flex container, and a
        flex container packs its children to the start whatever `text-align`
        says. Inside a block it stays inline, and an inline box goes where the
        inherited alignment puts it.
      */}
      <p className="mt-2">
        <OutboundLink
          // ⚠️ Absolute, through `loreDocsUrl`. Written root-relative it
          // resolves against Lore's own origin and 404s (feedback #P2142).
          href={loreDocsUrl("guides-artifacts")}
          className="text-sm underline underline-offset-4"
          data-testid="artifacts-empty-docs"
        >
          {tr("artifacts.empty.docs")}
        </OutboundLink>
      </p>
    </div>
  );
};

export default ArtifactsEmpty;
