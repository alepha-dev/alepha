import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";

import { ResourceRegistry } from "../resources/ResourceRegistry.ts";

/**
 * Filing one resource under another, by kind, for a page that names neither
 * owner (#E75, #Q2624): Knowledge's Folios tab on an epic files a folio
 * under it without importing Work's `EpicController`.
 *
 * ⚠️ No gate of its own beyond being signed in. The parent kind's `attach`
 * and `detach` go through the owning module's action, which keeps its gate
 * (`epic:write` on the epic) and its audit row, so this cannot file anything
 * the owner's own action would refuse.
 */
export class ResourceFilingController {
  protected readonly resources = $inject(ResourceRegistry);

  fileResource = $action({
    method: "POST",
    path: "/resources/:kind/:id/children",
    use: [$secure({ permissions: ["project:read"] })],
    schema: {
      params: z.object({ kind: z.text(), id: z.integer() }),
      body: z.object({ childKind: z.text(), childId: z.text() }),
    },
    handler: async ({ params, body }) => {
      const kind = this.resources.get(params.kind);
      if (!kind?.attach) {
        throw new NotFoundError(`Nothing can be filed under a ${params.kind}`);
      }
      await kind.attach(params.id, { kind: body.childKind, id: body.childId });
    },
  });

  unfileResource = $action({
    method: "DELETE",
    path: "/resources/:kind/:id/children/:childKind/:childId",
    use: [$secure({ permissions: ["project:read"] })],
    schema: {
      params: z.object({
        kind: z.text(),
        id: z.integer(),
        childKind: z.text(),
        childId: z.text(),
      }),
    },
    handler: async ({ params }) => {
      const kind = this.resources.get(params.kind);
      if (!kind?.detach) {
        throw new NotFoundError(`Nothing is filed under a ${params.kind}`);
      }
      await kind.detach(params.id, {
        kind: params.childKind,
        id: params.childId,
      });
    },
  });
}
