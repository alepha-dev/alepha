import {
  type WikiLinkPreviewProps,
  WikiLinkPreviewState,
} from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";

import type { FolioController } from "../../../../api/controllers/FolioController.ts";
import type { FolioResource } from "../../../../api/schemas/folioResourceSchema.ts";

/**
 * A folio's hover card: its title, its summary for agents when it has one,
 * and the first lines of its body with the markdown stripped. A protected
 * folio shows no body.
 *
 * Read through `useQuery` keyed on the reference (#E59, #Q2331), with the
 * five-minute `staleTime` `useElementLinks` gives the same references: a
 * second hover of the same link inside it sends nothing. Quiet on failure:
 * the card says the preview is unavailable, which is the whole of what a
 * reader needs from a hover.
 */
const FolioReferencePreview = (props: WikiLinkPreviewProps) => {
  const folioApi = useClient<FolioController>();
  const { projectId, id } = props;

  const query = useQuery<FolioPreviewData>(
    {
      key: ["wikilink-preview", projectId, `folio:${id}`],
      staleTime: [5, "minutes"],
      handler: async () => {
        const folio = (await folioApi.getByShortId({
          params: { projectId, shortId: Number(id) },
        })) as FolioResource;
        const body = folio.protected ? "" : stripMarkdown(folio.content ?? "");
        return {
          title: folio.title,
          summary: folio.summary || undefined,
          bodyPreview: body.split("\n").slice(0, 10).join("\n").slice(0, 600),
        };
      },
      onError: () => {},
    },
    [folioApi, projectId, id],
  );

  const data = query.data;
  if (!data) return <WikiLinkPreviewState loading={query.loading} />;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{data.title}</span>
      {data.summary && (
        <span className="text-muted-foreground text-xs italic">
          {data.summary}
        </span>
      )}
      {data.bodyPreview && (
        <pre className="text-muted-foreground max-h-32 overflow-hidden text-xs leading-relaxed whitespace-pre-wrap">
          {data.bodyPreview}
        </pre>
      )}
    </div>
  );
};

export default FolioReferencePreview;

interface FolioPreviewData {
  title: string;
  summary?: string;
  bodyPreview: string;
}

/**
 * Markdown down to prose, for a preview that is a few lines of plain text.
 */
const stripMarkdown = (raw: string): string =>
  raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~]/g, "")
    .trim();
