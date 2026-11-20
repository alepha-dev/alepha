import { useProjectAiContext } from "@lore/core/web";

import type { FolioResource } from "../../../../../api/schemas/folioResourceSchema.ts";

/**
 * Tells an assistant turn sent while a folio is open which folio it is
 * (#Q3972): its reference, title, type, summary and body. A protected
 * folio's body is a client-side encryption envelope, so it is left out.
 * Without a folio (the create page) only the project travels.
 */
export const useFolioAiContext = (folio: FolioResource | undefined): void => {
  useProjectAiContext(
    "folio",
    folio
      ? {
          kind: "folio",
          reference: `#F${folio.shortId}`,
          shortId: folio.shortId,
          title: folio.title,
          type: folio.type,
          summary: folio.summary || undefined,
          ...(folio.protected
            ? { protected: true }
            : { content: folio.content }),
        }
      : undefined,
  );
};
