import * as React from "react";

void React;

import { useI18n } from "alepha/react/i18n";
import { useEffect, useRef, useState } from "react";

import type { PaymentHandoff } from "../providers/CheckoutPaymentProvider.ts";

export interface PaymentSlotProps {
  /**
   * What the server returned from `POST /api/commerce/checkout/:id/pay`.
   */
  handoff: PaymentHandoff;
  /**
   * Where the PSP should send the payer back after a 3-D Secure detour.
   */
  returnUrl: string;
  /**
   * Renderers for embedded providers, keyed by the `provider` name the server
   * reported — `"stripe"`, `"mollie"`, `"memory"`. Omit it for a redirect-only
   * shop.
   */
  renderers?: Record<string, EmbeddedPaymentRenderer>;
  /**
   * Rendered while a redirect is being followed or an SDK is loading.
   */
  fallback?: React.ReactNode;
  onError?: (error: Error) => void;
}

/**
 * What an embedded provider must supply to be mountable.
 *
 * Deliberately a plain interface over a DOM node rather than a React component:
 * every PSP SDK wants to own a container element, and asking each of them to be
 * a well-behaved React component is how you end up fighting double-mounting in
 * StrictMode.
 */
export interface EmbeddedPaymentRenderer {
  /**
   * Mount the card field into `container` and take the payment.
   *
   * Must resolve when the payer has confirmed — not when the money has settled.
   * Settlement arrives by webhook, and the two are different events: treating
   * this promise as proof of payment is the mistake this comment exists to
   * prevent.
   *
   * Return a cleanup function; it runs on unmount.
   */
  mount(options: {
    container: HTMLElement;
    clientSecret: string;
    publishableKey: string;
    returnUrl: string;
    onConfirmed: () => void;
    onError: (error: Error) => void;
    /**
     * The strings a renderer shows, localised by the caller. Optional so a
     * renderer written against the first version of this interface still
     * mounts; it then falls back to English.
     */
    labels?: { pay?: string; declined?: string };
  }): Promise<() => void>;
}

/**
 * Renders whichever payment step the server chose.
 *
 * This is the component that makes the payment rail swappable from the front
 * end's point of view: a redirect handoff sends the browser away, an embedded one
 * mounts the matching renderer, and the page above knows about neither. Changing
 * PSP, or moving between hosted and embedded, changes nothing here.
 */
export const PaymentSlot = (props: PaymentSlotProps) => {
  const { handoff, returnUrl, renderers, fallback, onError } = props;
  const { tr } = useI18n();
  // Read through a ref inside the mount effect: the labels must not be a
  // dependency that re-mounts the PSP widget on every render.
  const labelsRef = useRef({
    pay: String(tr("commerce.checkout.pay", { default: "Pay" })),
    declined: String(
      tr("commerce.checkout.declined", {
        default: "The payment was declined.",
      }),
    ),
  });
  labelsRef.current = {
    pay: String(tr("commerce.checkout.pay", { default: "Pay" })),
    declined: String(
      tr("commerce.checkout.declined", {
        default: "The payment was declined.",
      }),
    ),
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<Error | undefined>();

  // A redirect handoff has nothing to render — leave for the PSP.
  useEffect(() => {
    if (handoff.mode === "redirect") {
      window.location.assign(handoff.url);
    }
  }, [handoff]);

  useEffect(() => {
    if (handoff.mode !== "embedded") {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const renderer = renderers?.[handoff.provider];
    if (!renderer) {
      const error = new Error(
        `No payment renderer registered for provider '${handoff.provider}'. ` +
          `Pass one in the \`renderers\` prop.`,
      );
      // The failure branch of mounting a third-party payment renderer into a DOM
      // node — an external system, and the node does not exist during render.
      // oxlint-disable-next-line react/set-state-in-effect
      setFailure(error);
      onError?.(error);
      return;
    }

    let cleanup: (() => void) | undefined;
    let cancelled = false;

    renderer
      .mount({
        container,
        clientSecret: handoff.clientSecret,
        publishableKey: handoff.publishableKey,
        returnUrl,
        labels: labelsRef.current,
        onConfirmed: () => setConfirmed(true),
        onError: (error) => {
          setFailure(error);
          onError?.(error);
        },
      })
      .then((dispose) => {
        // The effect may already have been torn down while the SDK loaded.
        if (cancelled) {
          dispose();
        } else {
          cleanup = dispose;
        }
      })
      .catch((error: Error) => {
        setFailure(error);
        onError?.(error);
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [handoff, renderers, returnUrl, onError]);

  if (handoff.mode === "redirect") {
    return <>{fallback ?? null}</>;
  }

  return (
    <div>
      <div ref={containerRef} />
      {failure ? (
        <p role="alert" data-payment-slot-error>
          {failure.message}
        </p>
      ) : null}
      {/*
        Deliberately not "payment successful": the payer has confirmed, and the
        order becomes paid when the webhook lands. Saying more than we know is how
        a customer is told their order is done and then finds it pending.
      */}
      {confirmed ? (
        <p data-payment-slot-confirmed>
          {tr("commerce.checkout.paymentSent", { default: "Payment sent…" })}
        </p>
      ) : null}
    </div>
  );
};
