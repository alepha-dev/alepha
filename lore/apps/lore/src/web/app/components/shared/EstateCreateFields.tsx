import { Control } from "@alepha/ui/components/control/control";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Cloud, Fingerprint, KeyRound, Server, Tag } from "lucide-react";
import { useState } from "react";

import { cloudflareTokenTemplateUrl } from "@/api/schemas/cloudflareTokenTemplate.ts";
import { ESTATE_SLUG_PATTERN } from "@/api/schemas/estateSlugSchema.ts";
import { loreDocsUrl } from "@/web/app/services/docsUrl.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import {
  type EstateCreateDraft,
  estateDraftSlug,
} from "./estateCreateDraft.ts";
import { estateCreateFormSchema } from "./estateCreateFormSchema.ts";
import { OutboundLink } from "./OutboundLink.tsx";

export interface EstateCreateFieldsProps {
  draft: EstateCreateDraft;
  onChange: (draft: EstateCreateDraft) => void;
  busy: boolean;
  /**
   * A refusal from the server, rendered beside the field it concerns.
   */
  error?: { message: string; field?: "accountId" | "token" };
  onSubmit?: () => void;
}

/**
 * The fields a new estate needs, by type.
 *
 * Shared by `/account/estates` and by the create-and-lend path inside a
 * project, so the two cannot ask for different things: they post the same
 * discriminated body to the same service, and a field one dialog forgets is
 * a refusal the other never sees.
 *
 * ⚠️ `bay` is selected by default, which is what keeps `estates.spec.ts` (it
 * fills the slug and submits, nothing else) and the Bay install guide
 * working unchanged.
 *
 * ⚠️ The token field is `type="password"` **and** `autoComplete="off"`. A
 * password manager offering to save a Cloudflare deploy token under
 * lore.alepha.dev is the leak the masked rendering was supposed to prevent.
 * It is never prefilled, cleared when the dialog closes, and never echoed in
 * a toast or an error. `Control`'s `password` gives the first, and its own
 * `autoComplete` prop the second - never `inputProps`, which
 * `ControlPassword` overrides with `"current-password"`.
 *
 * ## Every field is a labelled `Control` (feedback #P2143)
 *
 * They were bare `Input`s carrying PLACEHOLDERS where labels belong, which
 * is why the report opens "ovh-1 ?? what is ovh-1 ??". A placeholder names a
 * field only until somebody types in it, and the one description that
 * existed floated under its input with nothing tying the two together.
 *
 * ⚠️ **The form is the draft's mirror, not its owner.** The two dialogs hold
 * an `EstateCreateDraft` and derive submit-ability and the request body from
 * it (`estateDraftValid`, `estateDraftBody`), and they reset it on close. So
 * `initialValues` is seeded ONCE, from a `useState` initialiser rather than
 * from `props.draft` directly: seeded from the prop it would re-seed on
 * every keystroke, because the parent's draft changes on every keystroke.
 * Both dialogs unmount their content when they close, which is what puts a
 * fresh empty form behind the next open.
 */
const EstateCreateFields = (props: EstateCreateFieldsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const draft = props.draft;

  const normalized = estateDraftSlug(draft);
  // Only once something has been typed: an empty field is not yet a mistake.
  const slugError =
    normalized.length > 0 && !ESTATE_SLUG_PATTERN.test(normalized);
  const errorFor = (field: "accountId" | "token") =>
    props.error?.field === field ? props.error.message : undefined;

  // Captured on mount, never from `props.draft` - see this file's doc.
  const [initialValues] = useState(() => ({ ...props.draft }));

  const form = useForm({
    schema: estateCreateFormSchema,
    initialValues,
    // The dialogs own the submit button, and the request body is built from
    // the draft rather than from these values, so the form's own handler is
    // never reached.
    handler: () => props.onSubmit?.(),
    onChange: (_key, _value, store) =>
      props.onChange({
        type: store.type === "cloudflare" ? "cloudflare" : "bay",
        slug: String(store.slug ?? ""),
        accountId: String(store.accountId ?? ""),
        token: String(store.token ?? ""),
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      {/* "A machine" was a placeholder for a product name, and the product
          has one. The description under it follows the segment, so the
          explanation is attached to the choice rather than floating beside
          it. */}
      <Control
        segmented
        input={form.input.type}
        label={tr("estates.type.label")}
        description={
          draft.type === "bay"
            ? tr("estates.type.bay.description")
            : tr("estates.type.cloudflare.description")
        }
        disabled={props.busy}
        items={[
          {
            value: "bay",
            label: String(tr("estates.type.bay")),
            icon: <Server className="size-3.5" />,
          },
          {
            value: "cloudflare",
            label: String(tr("estates.type.cloudflare")),
            icon: <Cloud className="size-3.5" />,
          },
        ]}
      />

      <Control
        input={form.input.slug}
        label={tr("estates.add.slug")}
        // The answer to "what is ovh-1": the reader's own name for it,
        // nothing Cloudflare or the machine hands them.
        description={
          slugError ? tr("estates.add.invalid") : tr("estates.add.slug.hint")
        }
        icon={Tag}
        placeholder={String(tr("estates.add.slugPlaceholder"))}
        disabled={props.busy}
        inputProps={{
          "data-testid": "estate-create-slug",
          "aria-invalid": slugError || undefined,
        }}
      />

      {draft.type === "cloudflare" && (
        <>
          <div className="flex flex-col gap-1">
            <Control
              input={form.input.accountId}
              label={tr("estates.cloudflare.accountId")}
              // The hint used to float under the field with nothing tying
              // the two together; a Control puts it where it belongs.
              description={tr("estates.cloudflare.accountId.hint")}
              icon={Fingerprint}
              placeholder={String(
                tr("estates.cloudflare.accountId.placeholder"),
              )}
              disabled={props.busy}
              // Not clearable: an optional text field grows a clear button,
              // and this one is required the moment Cloudflare is picked -
              // it is optional in the SCHEMA only because a bay estate has
              // no such field at all.
              clearable={false}
              inputProps={{
                "data-testid": "estate-create-account",
                "aria-invalid": Boolean(errorFor("accountId")) || undefined,
              }}
            />
            {/* ⚠️ Below the control rather than in its `description`, and
                still `text-destructive`. `Control` takes its error from the
                form's own validation state and offers no prop for one, so a
                SERVER refusal routed through `description` would render in
                muted grey - a refusal that does not look like one. */}
            {errorFor("accountId") && (
              <span
                className="text-destructive text-xs"
                data-testid="estate-create-account-error"
              >
                {errorFor("accountId")}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Control
              password
              input={form.input.token}
              label={tr("estates.cloudflare.token")}
              icon={KeyRound}
              placeholder={String(tr("estates.cloudflare.token.placeholder"))}
              disabled={props.busy}
              clearable={false}
              // ⚠️ The second half of the protection this file documents,
              // and it MUST be this prop rather than `inputProps`:
              // `ControlPassword` writes `autoComplete` after spreading
              // `inputProps`, defaulting to `"current-password"` - which on
              // a Cloudflare deploy token is the password-manager prompt the
              // masking exists to avoid.
              autoComplete="off"
              inputProps={{
                "data-testid": "estate-create-token",
                "aria-invalid": Boolean(errorFor("token")) || undefined,
              }}
            />
            {/* Same reasoning as the account id above. */}
            {errorFor("token") && (
              <span
                className="text-destructive text-xs"
                data-testid="estate-create-token-error"
              >
                {errorFor("token")}
              </span>
            )}
            <span className="text-muted-foreground flex flex-col gap-1 text-xs">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {/* ⚠️ The mint link replaces the TEDIUM, not the
                    explanation: the form still asks for an account scope
                    and a TTL, and the token is still copied once. Both
                    links stay. */}
                <OutboundLink
                  href={cloudflareTokenTemplateUrl()}
                  className="underline underline-offset-4"
                  data-testid="estate-create-mint"
                >
                  {tr("estates.cloudflare.mint")}
                </OutboundLink>
                {/* The guide is the onboarding, not a footnote: which
                    template to start from, and the two permissions it
                    lacks. */}
                <OutboundLink
                  // ⚠️ Absolute, through `loreDocsUrl`. Written
                  // root-relative it resolved against Lore's own origin and
                  // 404'd (feedback #P2142).
                  href={loreDocsUrl("guides-cloudflare-token")}
                  className="underline underline-offset-4"
                  data-testid="estate-create-guide"
                >
                  {tr("estates.cloudflare.guide")}
                </OutboundLink>
              </span>
              {/* ⚠️ Said out loud because the link is NOT scoped:
                  `accountId=*` pre-selects All accounts, and whether a real
                  account id narrows the form has not been tested against a
                  live dashboard. Claiming a scope we have not verified
                  would be worse than the tedium being removed. */}
              <span>{tr("estates.cloudflare.mint.scope")}</span>
            </span>
          </div>
        </>
      )}

      {props.error && !props.error.field && (
        <span
          className="text-destructive text-xs"
          data-testid="estate-create-error"
        >
          {props.error.message}
        </span>
      )}
    </div>
  );
};

export default EstateCreateFields;
