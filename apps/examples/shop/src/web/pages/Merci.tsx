import type { OrderEntity, OrderItemEntity } from "@alepha/commerce";
import type { CheckoutController } from "@alepha/commerce/checkout";
import type { DurationLike } from "alepha/datetime";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { useState } from "react";

import { Poincon } from "../components/Poincon.tsx";
import { Prix } from "../components/Prix.tsx";

export interface MerciProps {
  order: OrderEntity;
  items: OrderItemEntity[];
  /**
   * Invoice numbers issued for this order, oldest first.
   */
  factures: string[];
  /**
   * The checkout session this page is showing — its own `:sessionId`.
   *
   * Passed down rather than read off the order: `orders` has no link back to
   * the session it came from (the payment rail is substitutable, so nothing
   * there is a foreign key), and this is the id the confirmation endpoint
   * takes.
   */
  sessionId: string;
}

/**
 * How often the page re-reads its own order while something is still in
 * flight, and how many times before it stops asking.
 *
 * Bounded because the confirmation is exactly the page a buyer leaves open. A
 * minute and a half covers a bank confirming late and an invoice being issued
 * a beat after the payment; past that there is an email coming and a reload
 * costs nothing, whereas a tab polling until it is closed costs the shop all
 * afternoon.
 */
const POLL_EVERY: DurationLike = [3, "seconds"];
const POLL_LIMIT = 30;

/**
 * The confirmation.
 *
 * Says what happened, what happens next, and where the invoice is — in that
 * order, because those are the three things a buyer wants in the ten seconds
 * after paying. No upsell, no newsletter box: the transaction is finished and the
 * page should feel finished too.
 */
const Merci = (props: MerciProps) => {
  const { tr } = useI18n();
  const client = useClient<CheckoutController>();
  const [latest, setLatest] = useState(props);
  const [attempts, setAttempts] = useState(0);

  /*
   * A different `:sessionId` is a different order, so what the poll remembers
   * about the last one must not outlive it. The router reuses this component
   * across such a navigation, and `useState` would keep the old confirmation.
   */
  const current = latest.sessionId === props.sessionId ? latest : props;
  const polling = isWaiting(current) && attempts < POLL_LIMIT;

  /*
   * The page said "this page will update" and then never did.
   *
   * An asynchronous rail — a bank redirect, a transfer — leaves the order
   * `pending` at the moment the buyer lands here, and the invoice is issued by
   * a hook on `commerce:order:paid`, so it can arrive a beat after a payment
   * that settled instantly. The copy promises both will appear on their own.
   * Neither did: the loader ran once, and nothing ever re-read it.
   *
   * `enabled` gates the run on mount and `runEvery` the ones after it. BOTH
   * have to go quiet, because they are independent: `runEvery` sets up its
   * interval from its own value alone, so a settled order left with a period
   * would keep polling forever.
   */
  useQuery(
    {
      handler: () =>
        client.commerceCheckoutOrder({ params: { id: props.sessionId } }),
      enabled: polling,
      runEvery: polling ? POLL_EVERY : undefined,
      onSuccess: (result) => {
        setLatest({ ...result, sessionId: props.sessionId });
        setAttempts((n) => n + 1);
      },
      // A failed read spends an attempt too. Counting successes only would
      // have made an endpoint that is down the one case that polls forever.
      onError: () => setAttempts((n) => n + 1),
    },
    [props.sessionId],
  );

  const { order, items, factures } = current;
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

/**
 * Whether anything the page promises is still on its way.
 *
 * Two conditions, not one: a payment that has not settled, and a settled one
 * whose invoice has not been issued yet. Both are things the copy says will
 * turn up by themselves — `thanks.pendingLede` and `thanks.invoiceSoon` — so
 * both are reasons to keep asking.
 *
 * A cancelled or refunded order is neither: no invoice is coming for it, and
 * without this it would poll out its whole budget waiting for one.
 */
const isWaiting = (confirmation: MerciProps): boolean => {
  const { status } = confirmation.order;
  if (status === "pending") {
    return true;
  }
  if (status === "cancelled" || status === "refunded") {
    return false;
  }
  return confirmation.factures.length === 0;
};

export default Merci;
