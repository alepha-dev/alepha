import { AlephaError } from "alepha";

import type { EmbeddedPaymentRenderer } from "./payment-slot.tsx";

/**
 * Minimal shape of the bits of stripe.js this renderer touches.
 *
 * Typed here rather than by depending on `@stripe/stripe-js`: the SDK must be
 * loaded from Stripe's own domain at runtime (they require it, for PCI scope),
 * so the npm package would buy types and nothing else — at the cost of a
 * dependency in a framework package.
 */
interface StripeLike {
  elements(options: { clientSecret: string }): {
    create(type: "payment"): { mount(selector: HTMLElement): void };
  };
  confirmPayment(options: {
    elements: unknown;
    confirmParams: { return_url: string };
    redirect?: "if_required";
  }): Promise<{ error?: { message?: string } }>;
}

/**
 * Mounts Stripe's Payment Element and confirms the payment.
 *
 * ⚠️ **This is a reference implementation and it has not been executed.**
 * Verifying it needs a real Stripe account, a publishable key and a browser;
 * everything else in this package is covered by tests, and this file is not.
 * Treat it as a starting point to be exercised against Stripe's test mode before
 * it goes anywhere near a customer.
 *
 * The two things it does get right by construction:
 *
 * - `redirect: "if_required"` so a card that needs no 3-D Secure never leaves the
 *   page, and one that does leaves and comes back to `returnUrl`.
 * - `onConfirmed` fires when Stripe accepted the confirmation, **not** when the
 *   money settled. Settlement is the webhook's job. A front end that treats
 *   confirmation as settlement will tell customers their order is complete
 *   before it is.
 */
export class StripePaymentRenderer implements EmbeddedPaymentRenderer {
  /**
   * Stripe requires their script be loaded from their domain, not bundled.
   */
  protected static readonly SDK_URL = "https://js.stripe.com/v3/";

  public async mount(options: {
    container: HTMLElement;
    clientSecret: string;
    publishableKey: string;
    returnUrl: string;
    onConfirmed: () => void;
    onError: (error: Error) => void;
    labels?: { pay?: string; declined?: string };
  }): Promise<() => void> {
    const stripe = await this.load(options.publishableKey);

    const elements = stripe.elements({ clientSecret: options.clientSecret });
    const paymentElement = elements.create("payment");

    const form = document.createElement("form");
    const mountPoint = document.createElement("div");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = options.labels?.pay ?? "Pay";
    form.append(mountPoint, submit);
    options.container.append(form);
    paymentElement.mount(mountPoint);

    const onSubmit = async (event: Event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const result = await stripe.confirmPayment({
          elements,
          confirmParams: { return_url: options.returnUrl },
          // No detour when the card does not require one.
          redirect: "if_required",
        });
        if (result.error) {
          // A declined card is a recoverable state, not a dead end: re-enable so
          // the payer can try another one.
          submit.disabled = false;
          options.onError(
            new AlephaError(
              result.error.message ??
                options.labels?.declined ??
                "The payment was declined.",
            ),
          );
          return;
        }
        options.onConfirmed();
      } catch (error) {
        submit.disabled = false;
        options.onError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    };

    form.addEventListener("submit", onSubmit);

    return () => {
      form.removeEventListener("submit", onSubmit);
      form.remove();
    };
  }

  /**
   * Load stripe.js once per page and initialise it.
   */
  protected async load(publishableKey: string): Promise<StripeLike> {
    const globalScope = window as unknown as {
      Stripe?: (key: string) => StripeLike;
    };

    if (!globalScope.Stripe) {
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(
          `script[src="${StripePaymentRenderer.SDK_URL}"]`,
        );
        if (existing) {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () =>
            reject(new AlephaError("Failed to load stripe.js")),
          );
          return;
        }
        const script = document.createElement("script");
        script.src = StripePaymentRenderer.SDK_URL;
        script.async = true;
        script.addEventListener("load", () => resolve());
        script.addEventListener("error", () =>
          reject(new AlephaError("Failed to load stripe.js")),
        );
        document.head.append(script);
      });
    }

    if (!globalScope.Stripe) {
      throw new AlephaError(
        "stripe.js loaded but did not expose window.Stripe",
      );
    }
    return globalScope.Stripe(publishableKey);
  }
}
