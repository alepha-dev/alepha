import type { CheckoutController } from "@alepha/commerce/checkout";
import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { z } from "alepha";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Prix } from "../components/Prix.tsx";
import { usePanier } from "../hooks/usePanier.ts";

/**
 * The countries the atelier ships to, as the checkout offers them.
 *
 * A short list rather than all 27: these are the ones with a delivery rate
 * configured, and offering a country you cannot deliver to is a promise you
 * break at the next step.
 */
const PAYS = [
  { value: "FR", label: "France" },
  { value: "BE", label: "Belgique" },
  { value: "DE", label: "Allemagne" },
  { value: "ES", label: "Espagne" },
  { value: "IT", label: "Italie" },
  { value: "LU", label: "Luxembourg" },
  { value: "NL", label: "Pays-Bas" },
  { value: "PT", label: "Portugal" },
  { value: "AT", label: "Autriche" },
  { value: "IE", label: "Irlande" },
];

/**
 * The address form, described once as a schema.
 *
 * `$control` metadata drives the layout and the browser's autofill, so the form
 * is generated rather than laid out by hand — and the autocomplete hints are what
 * make a checkout fillable in two taps on a phone, which is where most of these
 * orders will come from.
 */
/**
 * The address form, described once as a schema.
 *
 * Built from a translator rather than declared at module scope, because the field
 * labels are part of the schema's `meta` and therefore have to be localised with
 * everything else. `$control` metadata drives the layout and the browser's
 * autofill — those autocomplete hints are what make a checkout fillable in two
 * taps on a phone, which is where most of these orders will come from.
 */
const buildAdresseSchema = (tr: (key: string) => string | number) =>
  z.object({
    email: z.email().meta({
      title: String(tr("field.email")),
      description: String(tr("field.emailHint")),
      $control: { autoComplete: "email", width: 100 },
    }),
    fullName: z.text({ minLength: 1, maxLength: 200 }).meta({
      title: String(tr("field.fullName")),
      $control: { autoComplete: "name", width: 100 },
    }),
    line1: z.text({ minLength: 1, maxLength: 200 }).meta({
      title: String(tr("field.line1")),
      $control: { autoComplete: "address-line1", width: 100 },
    }),
    line2: z
      .text({ maxLength: 200 })
      .meta({
        title: String(tr("field.line2")),
        $control: { autoComplete: "address-line2", width: 100 },
      })
      .optional(),
    postalCode: z.text({ minLength: 2, maxLength: 16 }).meta({
      title: String(tr("field.postalCode")),
      $control: { autoComplete: "postal-code", width: 40 },
    }),
    locality: z.text({ minLength: 1, maxLength: 120 }).meta({
      title: String(tr("field.locality")),
      $control: { autoComplete: "address-level2", width: 60 },
    }),
    /*
     * `.meta()` before `.default()`, and the order is load-bearing.
     *
     * `.default()` wraps the schema, and the control peels wrappers with
     * `z.schema.unwrap()` before reading meta — so meta attached to the wrapper
     * is never seen. Written the other way round, this field lost its title and
     * fell back to the humanised property name: a French checkout with one field
     * labelled "Country", which no amount of `locale: fr-FR` would have fixed.
     */
    country: z
      .text({ minLength: 2, maxLength: 2 })
      .meta({
        title: String(tr("field.country")),
        $control: { autoComplete: "country", items: PAYS, width: 100 },
      })
      .default("FR"),
  });

interface Option {
  code: string;
  name: string;
  price: number;
  minDays?: number;
  maxDays?: number;
}

/**
 * The checkout, in three steps on one page.
 *
 * One page rather than three routes: the buyer can see what they have already
 * entered while entering the rest, and a back button never loses a step. The
 * totals panel re-reads from the server after every step, so the figure beside
 * the pay button is always the one the card will be charged.
 */
const Commande = () => {
  const client = useClient<CheckoutController>();
  const toast = useToast();
  const { panier } = usePanier();
  const { tr } = useI18n();

  /** Numbered because it genuinely is a sequence — each step needs the last. */
  const etapes = [
    { numero: 1, titre: tr("checkout.step1") },
    { numero: 2, titre: tr("checkout.step2") },
    { numero: 3, titre: tr("checkout.step3") },
  ];

  const [sessionId, setSessionId] = useState<string>();
  const [etape, setEtape] = useState(1);
  const [totaux, setTotaux] = useState<{
    subtotal: number;
    shippingTotal: number;
    taxTotal: number;
    grandTotal: number;
    currency: string;
  }>();
  const [options, setOptions] = useState<Option[]>([]);
  const [choix, setChoix] = useState<string>();
  const [enCours, setEnCours] = useState(false);

  // Open the checkout as soon as the page mounts: the session is what every
  // later step is addressed to.
  useEffect(() => {
    let annule = false;
    void (async () => {
      const session = await client.commerceCheckoutStart({ body: {} });
      if (!annule) {
        setSessionId(session.id);
        setTotaux(session);
      }
    })();
    return () => {
      annule = true;
    };
  }, [client]);

  const chargerLivraison = useCallback(
    async (id: string) => {
      const { options: dispo } = await client.commerceCheckoutShippingOptions({
        params: { id },
      });
      setOptions(dispo);
      // Preselect the cheapest — it is what most buyers pick, and it makes the
      // total on screen true before they touch anything.
      setChoix(dispo[0]?.code);
      if (dispo[0]) {
        setTotaux(
          await client.commerceCheckoutSetShippingMethod({
            params: { id },
            body: { code: dispo[0].code },
          }),
        );
      }
    },
    [client],
  );

  // Rebuilt when the language changes, so the labels follow.
  const adresseSchema = useMemo(() => buildAdresseSchema(tr), [tr]);

  const form = useForm({
    schema: adresseSchema,
    handler: async (values) => {
      if (!sessionId) return;
      const { email, ...adresse } = values;
      /*
       * A postcode that does not match its country comes back as a 400 naming the
       * field — "'1000' is not a valid postal code for France. Expected something
       * like '75001'." Surfacing the server's own message beats any client-side
       * guess, but nothing was surfacing it: the error escaped the handler and the
       * storefront mounts `Toaster` without the action-error toaster the admin's
       * `AppShell` provides. A customer who mistyped their postcode got no
       * feedback at all — the button simply did nothing.
       */
      try {
        await client.commerceCheckoutSetEmail({
          params: { id: sessionId },
          body: { email },
        });
        setTotaux(
          await client.commerceCheckoutSetAddress({
            params: { id: sessionId },
            body: adresse,
          }),
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : String(tr("checkout.addressFailed")),
        );
        return;
      }
      await chargerLivraison(sessionId);
      setEtape(2);
    },
  });

  const choisirLivraison = async (code: string) => {
    if (!sessionId) return;
    setChoix(code);
    setTotaux(
      await client.commerceCheckoutSetShippingMethod({
        params: { id: sessionId },
        body: { code },
      }),
    );
  };

  const payer = async () => {
    if (!sessionId) return;
    setEnCours(true);
    try {
      const { handoff } = await client.commerceCheckoutPay({
        params: { id: sessionId },
        body: { returnUrl: `${window.location.origin}/commande/${sessionId}` },
      });
      if (handoff.mode === "redirect") {
        window.location.assign(handoff.url as string);
        return;
      }
      // An embedded provider would mount <PaymentSlot/> here instead.
      toast.info(String(tr("checkout.embedded")));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : String(tr("checkout.payFailed")),
      );
    } finally {
      setEnCours(false);
    }
  };

  if (panier.lines.length === 0) {
    return (
      <section className="mx-auto w-full max-w-2xl px-5 py-24 text-center">
        <h1 className="estampe-lg">{tr("checkout.emptyCart")}</h1>
        <p className="text-muted-foreground mt-4">
          {tr("checkout.emptyCartLede")}
        </p>
        <Link
          href="/"
          className="estampe border-foreground hover:bg-foreground hover:text-background mt-8 inline-block border px-6 py-3 text-xs transition-colors"
        >
          {tr("cart.emptyCta")}
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto grid w-full max-w-5xl gap-12 px-5 py-12 md:grid-cols-[1fr_18rem] md:py-20">
      <div>
        <h1 className="estampe-lg">{tr("checkout.title")}</h1>

        <ol className="mesure mt-8 flex gap-6">
          {etapes.map((step) => (
            <li
              key={step.numero}
              className={
                step.numero === etape
                  ? "text-foreground"
                  : step.numero < etape
                    ? "text-muted-foreground"
                    : "text-muted-foreground/50"
              }
              aria-current={step.numero === etape ? "step" : undefined}
            >
              {String(step.numero).padStart(2, "0")} · {step.titre}
            </li>
          ))}
        </ol>

        <div className="trait mt-6 border-t pt-8">
          {etape === 1 ? (
            <AutoForm
              form={form}
              title={String(tr("checkout.addressTitle"))}
              submitLabel={String(tr("checkout.continue"))}
            />
          ) : null}

          {etape === 2 ? (
            <div>
              <h2 className="estampe text-sm">
                {tr("checkout.shippingTitle")}
              </h2>
              {options.length === 0 ? (
                <p className="text-muted-foreground mt-4">
                  {tr("checkout.noShipping")}
                </p>
              ) : (
                <ul className="mt-6 space-y-px">
                  {options.map((option) => (
                    <li key={option.code}>
                      <label
                        className={`flex cursor-pointer items-center gap-4 border px-4 py-4 transition-colors ${
                          choix === option.code
                            ? "border-foreground"
                            : "border-border hover:border-muted-foreground"
                        }`}
                      >
                        <input
                          type="radio"
                          name="livraison"
                          value={option.code}
                          checked={choix === option.code}
                          onChange={() => void choisirLivraison(option.code)}
                          className="accent-primary"
                        />
                        <span className="flex-1">
                          <span className="estampe block text-xs">
                            {option.name}
                          </span>
                          {option.minDays ? (
                            <span className="mesure text-muted-foreground">
                              {option.minDays === option.maxDays
                                ? tr("checkout.oneDay", {
                                    args: [String(option.minDays)],
                                  })
                                : tr("checkout.days", {
                                    args: [
                                      String(option.minDays),
                                      String(option.maxDays),
                                    ],
                                  })}
                            </span>
                          ) : null}
                        </span>
                        {option.price === 0 ? (
                          <span className="mesure text-primary">
                            {tr("checkout.free")}
                          </span>
                        ) : (
                          <Prix
                            cents={option.price}
                            currency={totaux?.currency}
                          />
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-8 flex gap-3">
                <Button
                  variant="outline"
                  className="estampe text-xs"
                  onClick={() => setEtape(1)}
                >
                  {tr("checkout.back")}
                </Button>
                <Button
                  className="estampe flex-1 text-xs"
                  onClick={() => setEtape(3)}
                >
                  {tr("checkout.continue")}
                </Button>
              </div>
            </div>
          ) : null}

          {etape === 3 ? (
            <div>
              <h2 className="estampe text-sm">{tr("checkout.payTitle")}</h2>
              <p className="text-muted-foreground mt-4 max-w-[52ch]">
                {tr("checkout.payLede")}
              </p>
              <p className="mesure text-muted-foreground mt-6">
                {tr("checkout.payDemo")}
              </p>

              <div className="mt-8 flex gap-3">
                <Button
                  variant="outline"
                  className="estampe text-xs"
                  onClick={() => setEtape(2)}
                >
                  {tr("checkout.back")}
                </Button>
                <Button
                  className="estampe h-12 flex-1 text-xs"
                  onClick={payer}
                  disabled={enCours || !sessionId}
                >
                  {enCours ? tr("checkout.redirecting") : tr("checkout.pay")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* The running total, always visible, always from the server. */}
      <aside className="trait h-fit border-t pt-6 md:sticky md:top-24">
        <h2 className="estampe text-xs">{tr("checkout.summary")}</h2>
        <dl className="mt-5 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{tr("cart.subtotal")}</dt>
            <dd>
              <Prix
                cents={totaux?.subtotal ?? panier.subtotal}
                currency={totaux?.currency}
              />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{tr("checkout.shipping")}</dt>
            <dd>
              {totaux && totaux.shippingTotal === 0 ? (
                <span className="mesure text-primary">
                  {tr("checkout.free")}
                </span>
              ) : (
                <Prix
                  cents={totaux?.shippingTotal ?? 0}
                  currency={totaux?.currency}
                />
              )}
            </dd>
          </div>
          <div className="trait flex justify-between border-t pt-3">
            <dt className="estampe text-xs">{tr("checkout.total")}</dt>
            <dd>
              <Prix
                cents={totaux?.grandTotal ?? panier.subtotal}
                currency={totaux?.currency}
                className="text-lg"
              />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="mesure text-muted-foreground">
              {tr("checkout.vat")}
            </dt>
            <dd className="mesure text-muted-foreground">
              <Prix cents={totaux?.taxTotal ?? 0} currency={totaux?.currency} />
            </dd>
          </div>
        </dl>
      </aside>
    </section>
  );
};

export default Commande;
