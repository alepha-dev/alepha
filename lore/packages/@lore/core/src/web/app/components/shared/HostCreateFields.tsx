import { Control } from "@alepha/ui/form";
import { useInject } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Tag } from "lucide-react";
import { useState } from "react";

import { HOST_SLUG_PATTERN } from "../../../../api/schemas/hostSlugSchema.ts";
import { HostTypeUiRegistry } from "../../registries/HostTypeUiRegistry.ts";
import { type I18n } from "../../services/I18n.ts";
import { type HostCreateDraft, hostDraftSlug } from "./hostCreateDraft.ts";
import { hostCreateFormSchema } from "./hostCreateFormSchema.ts";

export interface HostCreateFieldsProps {
  draft: HostCreateDraft;
  onChange: (draft: HostCreateDraft) => void;
  busy: boolean;
  /**
   * A refusal from the server, rendered beside the field it concerns.
   */
  error?: { message: string; field?: "accountId" | "token" };
  onSubmit?: () => void;
}

/**
 * The fields a new host needs, by type.
 *
 * Used by the create-and-lend path of a project's hosts list, and kept a
 * component of its own so any other place that creates a host asks for
 * the same thing: the same discriminated body to the same service.
 *
 * ⚠️ `bay` is selected by default, which is what keeps `hosts.spec.ts` (it
 * fills the slug and submits, nothing else) and the Bay install guide
 * working unchanged.
 *
 * ⚠️ The token field is `type="password"` **and** `autoComplete="off"`. A
 * password manager offering to save a Cloudflare deploy token under
 * lore.alepha.app is the leak the masked rendering was supposed to prevent.
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
 * an `HostCreateDraft` and derive submit-ability and the request body from
 * it (`hostDraftValid`, `hostDraftBody`), and they reset it on close. So
 * `initialValues` is seeded ONCE, from a `useState` initialiser rather than
 * from `props.draft` directly: seeded from the prop it would re-seed on
 * every keystroke, because the parent's draft changes on every keystroke.
 * Both dialogs unmount their content when they close, which is what puts a
 * fresh empty form behind the next open.
 */
const HostCreateFields = (props: HostCreateFieldsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const draft = props.draft;
  const registry = useInject(HostTypeUiRegistry);
  const types = registry.all();
  const picked = registry.get(draft.type);
  const TypeFields = picked?.CreateFields;

  const normalized = hostDraftSlug(draft);
  // Only once something has been typed: an empty field is not yet a mistake.
  const slugError =
    normalized.length > 0 && !HOST_SLUG_PATTERN.test(normalized);
  const errorFor = (field: "accountId" | "token") =>
    props.error?.field === field ? props.error.message : undefined;

  // Captured on mount, never from `props.draft` - see this file's doc.
  const [initialValues] = useState(() => ({ ...props.draft }));

  const form = useForm({
    schema: hostCreateFormSchema,
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
        label={tr("hosts.type.label")}
        description={
          picked ? tr(picked.descriptionKey as Parameters<typeof tr>[0]) : ""
        }
        disabled={props.busy}
        // Every registered type, in every project (#E166, review item 14).
        items={types.map((entry) => ({
          value: entry.type,
          label: tr(entry.labelKey as Parameters<typeof tr>[0]),
          icon: <entry.icon className="size-3.5" />,
        }))}
      />

      <Control
        input={form.input.slug}
        label={tr("hosts.add.slug")}
        // The answer to "what is ovh-1": the reader's own name for it,
        // nothing Cloudflare or the machine hands them.
        description={
          slugError ? tr("hosts.add.invalid") : tr("hosts.add.slug.hint")
        }
        icon={Tag}
        placeholder={tr("hosts.add.slugPlaceholder")}
        disabled={props.busy}
        inputProps={{
          "data-testid": "host-create-slug",
          "aria-invalid": slugError || undefined,
        }}
      />

      {/* The fields of the picked type, from its module (#E166). */}
      {TypeFields ? (
        <TypeFields form={form} busy={props.busy} errorFor={errorFor} />
      ) : null}

      {props.error && !props.error.field && (
        <span
          className="text-danger-text text-xs"
          data-testid="host-create-error"
        >
          {props.error.message}
        </span>
      )}
    </div>
  );
};

export default HostCreateFields;
