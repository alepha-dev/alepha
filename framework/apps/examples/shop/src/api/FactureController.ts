import { InvoiceRenderer, InvoiceService } from "@alepha/commerce/invoicing";
import { $inject, z } from "alepha";
import { $route, NotFoundError, type ServerReply } from "alepha/server";

/**
 * Serves an invoice through whichever renderer is registered — printable HTML by
 * default, a PDF if the deployment substituted one.
 *
 * A `$route` and not a `$page`: an invoice is a document, not a screen. It should
 * be printable, savable and openable without the application shell around it,
 * and its content type is the renderer's business rather than React's.
 *
 * ⚠️ No authorisation, deliberately, and worth being explicit about: an invoice
 * number is the only credential. That is acceptable for a demo and **not** for a
 * real shop — the number is sequential, so anyone can enumerate a competitor's
 * order volume, and every customer's address is one guess away. A real
 * deployment gates this on the session's user owning the order, or on a
 * random per-invoice token.
 */
export class FactureController {
  protected readonly invoices = $inject(InvoiceService);
  protected readonly renderer = $inject(InvoiceRenderer);

  public readonly facture = $route({
    method: "GET",
    path: "/facture/:number",
    schema: { params: z.object({ number: z.text({ maxLength: 40 }) }) },
    handler: async ({ params, reply }) => {
      const invoice = await this.invoices.findByNumber(params.number);
      if (!invoice) {
        throw new NotFoundError(`No invoice ${params.number}`);
      }
      const rendered = await this.renderer.render(invoice);
      this.serveAs(reply, rendered.contentType, rendered.filename);
      return rendered.body as string;
    },
  });

  protected serveAs(
    reply: ServerReply,
    contentType: string,
    filename: string,
  ): void {
    reply.headers["content-type"] = contentType;
    // `inline` rather than `attachment`: a customer clicking "Facture" wants to
    // look at it, and can still save it from the viewer.
    reply.headers["content-disposition"] = `inline; filename="${filename}"`;
  }
}
