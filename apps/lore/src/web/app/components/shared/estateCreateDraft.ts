import { CLOUDFLARE_ACCOUNT_ID_PATTERN } from "@/api/schemas/cloudflareCredentialSchema.ts";
import type { CreateEstateBody } from "@/api/schemas/createEstateBodySchema.ts";
import { ESTATE_SLUG_PATTERN } from "@/api/schemas/estateSlugSchema.ts";

/**
 * What both create dialogs hold while somebody is filling them in.
 *
 * One shape rather than a bag of `useState` calls per dialog, because the
 * account page and the create-and-lend path must agree about what a type
 * requires: they post the same body to the same service, and a field one of
 * them forgets is a refusal the other never sees.
 *
 * The token lives here for the length of the dialog and nowhere else: it is
 * cleared on close, never put in a toast, and never sent back by any read.
 */
export interface EstateCreateDraft {
  type: "bay" | "cloudflare";
  slug: string;
  accountId: string;
  token: string;
}

export const emptyEstateDraft = (): EstateCreateDraft => ({
  type: "bay",
  slug: "",
  accountId: "",
  token: "",
});

/**
 * The slug as it will be stored. Normalised before it is validated, like the
 * server does: `OVH-1` is accepted as input and becomes `ovh-1`, rather than
 * being refused for a case nobody meant as a distinction.
 */
export const estateDraftSlug = (draft: EstateCreateDraft): string =>
  draft.slug.trim().toLowerCase();

/**
 * Whether the form can be submitted at all.
 *
 * The token's only client-side rule is its length, matching
 * `cloudflareTokenSchema`: Cloudflare has changed the format once already,
 * and a pattern here would refuse a valid token before any probe could say
 * otherwise.
 */
export const estateDraftValid = (draft: EstateCreateDraft): boolean => {
  if (!ESTATE_SLUG_PATTERN.test(estateDraftSlug(draft))) {
    return false;
  }
  if (draft.type === "bay") {
    return true;
  }
  return (
    CLOUDFLARE_ACCOUNT_ID_PATTERN.test(draft.accountId.trim()) &&
    draft.token.trim().length >= 40
  );
};

/**
 * The draft as the discriminated body the two create endpoints take.
 */
export const estateDraftBody = (draft: EstateCreateDraft): CreateEstateBody =>
  draft.type === "cloudflare"
    ? {
        type: "cloudflare",
        slug: estateDraftSlug(draft),
        accountId: draft.accountId.trim(),
        token: draft.token.trim(),
      }
    : { slug: estateDraftSlug(draft) };

/**
 * Which field a server refusal belongs beside.
 *
 * `EstateService.assertCredential` puts it on the error's `data`, which
 * survives the round trip (`HttpError.toJSON`, read back through
 * `errorSchema`). An error without one renders above the buttons: a wrong
 * account id and a missing permission are not fixed in the same field, and
 * guessing which is worse than saying nothing.
 */
export const estateErrorField = (
  error: unknown,
): "accountId" | "token" | undefined => {
  const field = (error as { data?: { field?: unknown } })?.data?.field;
  return field === "accountId" || field === "token" ? field : undefined;
};

export const estateErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
