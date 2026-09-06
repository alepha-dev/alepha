import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { useI18n } from "alepha/react/i18n";

import {
  ESTATE_SLUG_MAX_LENGTH,
  ESTATE_SLUG_PATTERN,
} from "@/api/schemas/estateSlugSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import {
  type EstateCreateDraft,
  estateDraftSlug,
} from "./estateCreateDraft.ts";

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
 * a toast or an error.
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

  const set = (over: Partial<EstateCreateDraft>) =>
    props.onChange({ ...draft, ...over });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2" role="group">
        {(["bay", "cloudflare"] as const).map((type) => (
          <Button
            key={type}
            type="button"
            size="sm"
            variant={draft.type === type ? "default" : "outline"}
            aria-pressed={draft.type === type}
            disabled={props.busy}
            data-testid={`estate-type-${type}`}
            onClick={() => set({ type })}
          >
            {type === "bay"
              ? tr("estates.type.bay")
              : tr("estates.type.cloudflare")}
          </Button>
        ))}
      </div>

      <span className="text-muted-foreground text-sm">
        {draft.type === "bay"
          ? tr("estates.type.bay.description")
          : tr("estates.type.cloudflare.description")}
      </span>

      <div className="flex flex-col gap-1">
        <Input
          value={draft.slug}
          onChange={(event) => set({ slug: event.target.value })}
          placeholder={tr("estates.add.slugPlaceholder")}
          maxLength={ESTATE_SLUG_MAX_LENGTH}
          aria-label={tr("estates.add.slug")}
          aria-invalid={slugError || undefined}
          data-testid="estate-create-slug"
        />
        {slugError && (
          <span className="text-destructive text-xs">
            {tr("estates.add.invalid")}
          </span>
        )}
      </div>

      {draft.type === "cloudflare" && (
        <>
          <div className="flex flex-col gap-1">
            <Input
              value={draft.accountId}
              onChange={(event) => set({ accountId: event.target.value })}
              placeholder={tr("estates.cloudflare.accountId.placeholder")}
              maxLength={64}
              aria-label={tr("estates.cloudflare.accountId")}
              aria-invalid={Boolean(errorFor("accountId")) || undefined}
              data-testid="estate-create-account"
            />
            <span className="text-muted-foreground text-xs">
              {tr("estates.cloudflare.accountId.hint")}
            </span>
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
            <Input
              type="password"
              autoComplete="off"
              value={draft.token}
              onChange={(event) => set({ token: event.target.value })}
              placeholder={tr("estates.cloudflare.token.placeholder")}
              maxLength={128}
              aria-label={tr("estates.cloudflare.token")}
              aria-invalid={Boolean(errorFor("token")) || undefined}
              data-testid="estate-create-token"
            />
            <span className="text-muted-foreground text-xs">
              {/* The guide is the onboarding, not a footnote: which template
                  to start from, and the two permissions it lacks. */}
              <a
                href="/lore/docs/guides-cloudflare-token"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
                data-testid="estate-create-guide"
              >
                {tr("estates.cloudflare.guide")}
              </a>
            </span>
            {errorFor("token") && (
              <span
                className="text-destructive text-xs"
                data-testid="estate-create-token-error"
              >
                {errorFor("token")}
              </span>
            )}
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
