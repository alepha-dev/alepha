import type { OrderEntity, OrderItemEntity } from "@alepha/commerce";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Poincon } from "../components/Poincon.tsx";
import { Prix } from "../components/Prix.tsx";

export interface MerciProps {
  order: OrderEntity;
  items: OrderItemEntity[];
  /** Invoice numbers issued for this order, oldest first. */
  factures: string[];
}

/**
 * The confirmation.
 *
 * Says what happened, what happens next, and where the invoice is — in that
 * order, because those are the three things a buyer wants in the ten seconds
 * after paying. No upsell, no newsletter box: the transaction is finished and the
 * page should feel finished too.
 */
const Merci = (props: MerciProps) => {
  const { order, items, factures } = props;
  const { tr } = useI18n();

  const attente = order.status === "pending";

  return (
    <section className="mx-auto w-full max-w-2xl px-5 py-16 md:py-24">
      <div className="pose flex items-center gap-5">
        <Poincon titre="AA" size="lg" className="text-primary" />
        <div>
          <h1 className="estampe-lg">
            {attente ? tr("thanks.pending") : tr("thanks.title")}
          </h1>
          <p className="mesure text-muted-foreground mt-2">
            {tr("thanks.order", { args: [order.id.slice(0, 8).toUpperCase()] })}
          </p>
        </div>
      </div>

      <p className="text-muted-foreground mt-8">
        {attente ? tr("thanks.pendingLede") : tr("thanks.paidLede")}
      </p>

      <ul className="trait mt-10 border-t">
        {items.map((item) => (
          <li
            key={item.id}
            className="trait flex items-baseline justify-between gap-4 border-t py-4 first:border-t-0"
          >
            <span>
              <span className="estampe text-xs">{item.name}</span>
              {item.quantity > 1 ? (
                <span className="mesure text-muted-foreground ml-2">
                  × {item.quantity}
                </span>
              ) : null}
            </span>
            <Prix
              cents={item.unitPrice * item.quantity}
              currency={order.currency}
            />
          </li>
        ))}
      </ul>

      <dl className="trait mt-2 space-y-2 border-t pt-5 text-sm">
        {order.shippingTotal > 0 ? (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              {tr("thanks.shipping")}
              {order.shippingMethod ? ` · ${order.shippingMethod}` : ""}
            </dt>
            <dd>
              <Prix cents={order.shippingTotal} currency={order.currency} />
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt className="estampe text-xs">{tr("thanks.total")}</dt>
          <dd>
            <Prix
              cents={order.total}
              currency={order.currency}
              className="text-lg"
            />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="mesure text-muted-foreground">{tr("thanks.vat")}</dt>
          <dd className="mesure text-muted-foreground">
            <Prix cents={order.taxTotal} currency={order.currency} />
          </dd>
        </div>
      </dl>

      {factures.length > 0 ? (
        <div className="mt-10 flex flex-wrap gap-3">
          {factures.map((numero) => (
            <a
              key={numero}
              href={`/facture/${numero}`}
              /*
               * `data-no-router` so the click is a real navigation.
               *
               * The invoice is served by a `$route` — a server route, which the
               * client router knows nothing about. Left to itself the router
               * intercepted the click, looked for a *page* at `/facture/…`, found
               * none and rendered its own 404. The request never left the browser,
               * which is why the same URL answered perfectly to `curl` and the
               * link looked broken only in the app.
               */
              data-no-router
              className="estampe border-foreground hover:bg-foreground hover:text-background border px-5 py-3 text-xs transition-colors"
            >
              {tr("thanks.invoice", { args: [numero] })}
            </a>
          ))}
        </div>
      ) : (
        <p className="mesure text-muted-foreground mt-10">
          {tr("thanks.invoiceSoon")}
        </p>
      )}

      <p className="mesure text-muted-foreground trait mt-12 border-t pt-6">
        {tr("thanks.withdrawal")}
      </p>

      <Link
        href="/"
        className="mesure text-muted-foreground hover:text-foreground mt-8 inline-block transition-colors"
      >
        {tr("thanks.back")}
      </Link>
    </section>
  );
};

export default Merci;
