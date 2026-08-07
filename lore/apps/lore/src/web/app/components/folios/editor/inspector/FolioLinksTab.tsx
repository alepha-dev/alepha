import { Button } from "@alepha/ui/components/ui/button";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ArrowUpRight, File as FileIcon } from "lucide-react";
import type { ReactElement } from "react";
import type {
  FolioLinks,
  FolioResource,
} from "@/api/schemas/folioResourceSchema.ts";
import type { AppRouter } from "../../../../AppRouter.ts";
import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";

export interface FolioLinksTabProps {
  /**
   * `undefined` in create mode — nothing has been saved yet, so there is
   * nothing to resolve links against.
   *
   * Typed as `FolioResource` (the bare `Folio` entity plus an optional
   * `metadata`), not the bare `Folio` type `FolioInspectorProps` uses —
   * `Folio` structurally satisfies `FolioResource` (`metadata` is
   * optional), so `FolioInspector` can still pass its own `folio` prop
   * straight through with no cast. The route loader populates `metadata`
   * at runtime (`getByShortId({ query: { withLinks: true } })`); the bare
   * `Folio` type just doesn't know that, the same gap `AppRouter.ts`'s
   * `projectFoliosFolio.head()` already casts around.
   */
  folio?: FolioResource;
}

type Ref = FolioLinks["outbound"][number] | FolioLinks["inbound"][number];

/**
 * The Links tab — ported from the deleted `FolioBacklinksPanel.tsx`.
 * Reads `folio.metadata?.links`, which the route loader already populates
 * via `withLinks: true`.
 *
 * This tab is load-bearing, not a sidebar afterthought: merging the old
 * read view into the always-editable workspace means `[[wiki-links]]` no
 * longer render as clickable links inside the body — MDXEditor has no
 * idea what that syntax means. This list is the only way left to
 * navigate them.
 *
 * One thing this restyle deliberately does NOT add: excerpts on the
 * Backlinks (inbound) rows. `FolioLinks["inbound"]` (see
 * `folioResourceSchema.ts`) only carries `kind` / `shortId` / `title` /
 * `path` — there is no excerpt field anywhere in the resolved-links
 * payload the server sends. Showing one would mean fabricating text that
 * was never fetched; the brief called for excerpts, but the data to back
 * them doesn't exist yet. See the task report.
 *
 * A `blob` outbound ref renders as plain, NON-navigable text (not a
 * `Link`) — carried over from the deleted `FolioBacklinksPanel.tsx`, that
 * kind used to fall through to the same `projectFoliosFolio` route every
 * `folio` ref uses, with `ref.shortId` as the param. That's wrong:
 * `FolioController.folioShortId` and `FolioBlobService.blobShortId` are
 * two INDEPENDENT per-project `$sequence()` counters, so a folio and a
 * blob routinely share a shortId — a folio containing `[[blob#3]]` got
 * an Outgoing row that opened whichever *folio* happens to own shortId
 * 3, an unrelated document (or a dead route, if no folio does). The
 * correct fix would be a real `/api/files/:id` download link, but
 * `resolveLinks` (`FolioController.ts`) never sends a blob ref's
 * underlying `files` row id in the first place — only `shortId` / `title`
 * / `path` — so there is nothing on the client to build that URL from
 * without a server-side schema change. Rendering non-navigable is the
 * fix that's correct with the data actually available today.
 */
const FolioLinksTab = (props: FolioLinksTabProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const projectId = project ? String(project.id) : "";

  const links = props.folio?.metadata?.links;
  const inbound = links?.inbound ?? [];
  const outbound = links?.outbound ?? [];

  if (inbound.length === 0 && outbound.length === 0) {
    return (
      <p className="text-muted-foreground px-3 py-4 text-center text-xs italic">
        {tr("folios.editor.inspector.no-links")}
      </p>
    );
  }

  const renderRefs = (refs: Ref[]) => (
    <ul className="flex flex-col gap-0.5 px-1.5">
      {refs.map((ref) => {
        const pathSegments = ref.kind !== "quest" ? ref.path : undefined;
        const label = (
          <>
            <span className="flex min-w-0 flex-1 flex-col items-start gap-0">
              {pathSegments && pathSegments.length > 0 && (
                <span className="folio-mono text-muted-foreground w-full truncate text-[10px]">
                  {pathSegments.map((p) => p.name).join("/")}/
                </span>
              )}
              <span className="w-full truncate text-left">{ref.title}</span>
            </span>
            <span className="folio-mono text-muted-foreground shrink-0 text-[10px]">
              {ref.kind === "quest" ? `Q#${ref.shortId}` : `#${ref.shortId}`}
            </span>
          </>
        );

        // No client-addressable target — see this file's doc. Plain,
        // non-navigable row instead of a link to the wrong document.
        if (ref.kind === "blob") {
          return (
            <li key={`${ref.kind}-${ref.shortId}`}>
              <div className="text-muted-foreground/70 flex w-full items-center gap-2 px-2 py-1.5 text-sm">
                <FileIcon className="size-3.5 shrink-0" />
                {label}
              </div>
            </li>
          );
        }

        const route =
          ref.kind === "quest" ? "projectQuest" : "projectFoliosFolio";
        return (
          <li key={`${ref.kind}-${ref.shortId}`}>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto w-full justify-start gap-2 px-2 py-1.5"
              render={
                <Link
                  href={router.path(route, {
                    params: {
                      projectId,
                      shortId: String(ref.shortId),
                    },
                  })}
                />
              }
            >
              <ArrowUpRight className="text-muted-foreground size-3.5 shrink-0" />
              {label}
            </Button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex flex-col gap-4 py-2">
      {inbound.length > 0 && (
        <section>
          <h3 className="text-muted-foreground mb-1 px-3 text-[10.5px] font-medium uppercase tracking-[0.1em]">
            {tr("folios.editor.inspector.backlinks")}
          </h3>
          {renderRefs(inbound)}
        </section>
      )}
      {outbound.length > 0 && (
        <section>
          <h3 className="text-muted-foreground mb-1 px-3 text-[10.5px] font-medium uppercase tracking-[0.1em]">
            {tr("folios.editor.inspector.outgoing")}
          </h3>
          {renderRefs(outbound)}
        </section>
      )}
    </div>
  );
};

export default FolioLinksTab;
