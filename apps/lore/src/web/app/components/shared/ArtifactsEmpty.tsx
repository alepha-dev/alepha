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
    <div className="flex flex-col items-start gap-2 py-2 text-left">
      <p className="text-muted-foreground max-w-prose text-sm">
        {props.description}
      </p>

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
