import { AlephaPaymentsStripe } from "@alepha/payments-stripe";
import { adminRouterOptionsAtom } from "@alepha/ui/components/admin/admin-router-options";
import { Alepha, run } from "alepha";

import { ShopApi } from "./api/index.ts";
import { shopAdminOptions } from "./web/adminChrome.tsx";
import { ShopWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "SHOP",
  },
});

/*
 * Stripe when a key is configured, the in-memory provider otherwise.
 *
 * ### Why the condition, and why here
 *
 * `AlephaPaymentsStripe` substitutes `PaymentProvider` unconditionally, and
 * `StripePaymentProvider` declares `STRIPE_SECRET_KEY` as required — so importing
 * the module with no key configured fails at boot on env validation. A module's
 * `imports` are static, so the choice cannot live inside `ShopApi`: it has to be
 * made here, where the container is assembled.
 *
 * ### Why before `ShopApi`
 *
 * `alepha/api/payments` registers `MemoryPaymentProvider` with
 * `optional: true` — "skip if somebody already claimed this slot". Registering
 * Stripe first is therefore the whole mechanism: the memory registration steps
 * aside. The other order would race against instantiation and earn a
 * `TooLateSubstitutionError`.
 *
 * ### What each branch means for the running shop
 *
 * With a key, the funnel hands off to Stripe Checkout and the order is settled by
 * the `/api/payments/webhook` delivery — which is why `STRIPE_WEBHOOK_SECRET`
 * matters as much as the secret key: without it the payment succeeds at Stripe
 * and the shop never hears about it.
 *
 * Without a key, the funnel uses `MockCheckoutController`, which refuses to serve
 * in production. That is the right default for dev and for the e2e suite — which
 * depends on the mock — and a dead end on a deployed site. Configure Stripe
 * before deploying, or accept a storefront you cannot buy from.
 */
if (process.env.STRIPE_SECRET_KEY) {
  alepha.with(AlephaPaymentsStripe);
}

alepha.with(ShopApi);
alepha.with(ShopWeb);
alepha.set(adminRouterOptionsAtom, shopAdminOptions);

run(alepha);
