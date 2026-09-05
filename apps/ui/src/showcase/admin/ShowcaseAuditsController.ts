import { $inject, z } from "alepha";
import {
  auditActionPairSchema,
  auditQuerySchema,
  auditResourceSchema,
} from "alepha/api/audits";
import { $action } from "alepha/server";

import { ShowcaseAudits } from "./ShowcaseAudits.ts";

/**
 * Stands in for `AdminAuditController` so `<AdminAudits />` renders real rows.
 *
 * ⚠️ The property names ARE the action names, and they must match the real
 * controller exactly. `LinkProvider`'s virtual client is a flat proxy:
 * `client.findAudits(...)` dispatches the action literally named
 * `findAudits`, so a rename here silently breaks the component with
 * "Action not found" and an empty table.
 *
 * The schemas are IMPORTED from `alepha/api/audits` rather than re-declared.
 * That is the whole point: `schema.response` is what serializes, so borrowing
 * the real one means a column added upstream either appears here too or fails
 * loudly, instead of the showcase drifting into a polite lie about what the
 * component renders.
 *
 * Only the three actions `AdminAudits` actually calls are declared. The real
 * controller has ten; the rest would be fixtures nothing reads.
 */
export class ShowcaseAuditsController {
  protected readonly audits = $inject(ShowcaseAudits);

  public readonly findAudits = $action({
    path: "/admin/audits",
    schema: {
      query: auditQuerySchema,
      response: z.page(auditResourceSchema),
    },
    handler: ({ query }) => this.audits.paginate(query as any),
  });

  /**
   * The filter's `type:action` pairs.
   *
   * `AdminAudits` swallows a failure from this call, so getting it wrong costs
   * an empty filter dropdown and no error anywhere.
   */
  public readonly getAuditActions = $action({
    path: "/admin/audits/actions",
    schema: {
      response: z.array(auditActionPairSchema),
    },
    handler: () => this.audits.actionPairs() as any,
  });

  /**
   * Accepts the call and changes nothing.
   *
   * The showcase is a read-only reference served to everyone at once, so a
   * delete that actually removed rows would let one visitor empty the page for
   * the next. Answering truthfully (the component toasts and refetches) while
   * leaving the dataset alone is the honest compromise.
   */
  public readonly deleteAudits = $action({
    method: "DELETE",
    path: "/admin/audits",
    schema: {
      body: z.object({ ids: z.array(z.text()) }),
      response: z.object({ deleted: z.integer() }),
    },
    handler: ({ body }) => ({ deleted: body.ids.length }),
  });
}
