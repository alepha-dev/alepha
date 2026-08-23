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
 * This tab is load-bearing, not a sidebar afterthought: it lists every
 * link of the folio in one place, whichever face of the document is
 * showing, and it is the only place the inbound ones appear.
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
 * 3, an unrelated document (or a dead route, if no folio does).
 *
 * A real download link IS reachable — `BlobController.getBlobByShortId`
 * (`GET /projects/:projectId/folio/blobs/by-short-id/:shortId`,
 * member-gated, already used by the MCP `blob_*` tools) resolves a
 * shortId to the hydrated blob record, whose `id` is the underlying
 * `files` row id `/api/files/:id` downloads need — the same id
 * `FolioBrowser.tsx`'s own blob rows already open with
 * `window.open(\`/api/files/${entry.id}\`, ...)`. This tab renders
 * non-navigable anyway: `resolveLinks` (`FolioController.ts`) doesn't
 * send that id inline with the outbound ref, only `shortId` / `title` /
 * `path`, so making a blob row clickable means firing a resolve call on
 * render for every blob ref this tab shows — a fetch-on-render this
 * otherwise-synchronous tab doesn't have today. Deliberately deferred,
 * not blocked: plain text is honest about "no link" without a false
 * "impossible" claim, and is strictly safer than the wrong-route bug it
 * replaces. See the task report.
 */
const FolioLinksTab = (props: FolioLinksTabProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const projectSlug = project ? project.slug : "";

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
        // Only folios sit in the directory tree, so only they have a path
        // to show above the title.
        const pathSegments = ref.kind === "folio" ? ref.path : undefined;
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
              {KIND_PREFIX[ref.kind] ?? ""}#{ref.shortId}
            </span>
          </>
        );

        // No client-addressable target — see this file's doc. Plain,
        // non-navigable row instead of a link to the wrong document.
        //
        // `comment` joins `blob` here deliberately. Comments do not exist
        // yet but `linkSourceKind` already names them, and the route switch
        // below ends in a folio fallback — so without this guard the first
        // comment backlink would render as a link to a folio whose id it
        // merely shares the shape of. A row that goes nowhere is the honest
        // placeholder until comments have a route.
        if (ref.kind === "blob" || ref.kind === "comment") {
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
          ref.kind === "quest"
            ? "projectQuest"
            : ref.kind === "epic"
              ? "projectEpic"
              : "projectFoliosFolio";
        // Every element route names its param differently, and the router
        // merges the CURRENT route's params before yours — so passing the
        // wrong name silently inherits the open folio's id instead of
        // erroring. See `AppRouter`'s note on `:epicNumber`.
        const idParam = ref.kind === "epic" ? "epicNumber" : "shortId";
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
                      projectSlug,
                      [idParam]: String(ref.shortId),
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
          <h3 className="text-muted-foreground mb-1 px-3 text-[10.5px] font-medium tracking-[0.1em] uppercase">
            {tr("folios.editor.inspector.backlinks")}
          </h3>
          {renderRefs(inbound)}
        </section>
      )}
      {outbound.length > 0 && (
        <section>
          <h3 className="text-muted-foreground mb-1 px-3 text-[10.5px] font-medium tracking-[0.1em] uppercase">
            {tr("folios.editor.inspector.outgoing")}
          </h3>
          {renderRefs(outbound)}
        </section>
      )}
    </div>
  );
};

export default FolioLinksTab;

/**
 * One-letter disambiguator before the number in a link row, because the
 * numbers of different kinds overlap freely — folio #3 and epic #3 both
 * exist. A folio takes no prefix: it is what `[[…]]` means unqualified, so
 * a bare `#3` reads as one for the same reason the syntax does.
 */
const KIND_PREFIX: Record<string, string> = {
  quest: "Q",
  comment: "C",
  epic: "E",
  blob: "F",
};
