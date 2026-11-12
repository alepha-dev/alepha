import { AlephaPaymentsStripe } from "@alepha/payments-stripe";
import { accountRouterOptionsAtom } from "@alepha/ui/account";
import { adminRouterOptionsAtom } from "@alepha/ui/admin";
import { Alepha, run } from "alepha";
import { helmetOptions } from "alepha/server";

import { ShopApi } from "./api/index.ts";
import { shopAccountOptions } from "./web/accountChrome.tsx";
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
// The strict Content Security Policy (#E130): scripts by hash or per-request
// nonce, no 'unsafe-inline'. The e2e suite runs under it and fails on the
// first violation, so it stays true.
alepha.store.mut(helmetOptions, (old) => ({
  ...old,
  // Trusted Types too (#Q3320): the framework's DOM sinks go through its
  // `alepha` policy, and the suite fails on any other.
  contentSecurityPolicy: { trustedTypes: true },
}));

if (process.env.STRIPE_SECRET_KEY) {
  alepha.with(AlephaPaymentsStripe);
}

alepha.with(ShopApi);
alepha.with(ShopWeb);
alepha.set(adminRouterOptionsAtom, shopAdminOptions);
alepha.set(accountRouterOptionsAtom, shopAccountOptions);

run(alepha);
