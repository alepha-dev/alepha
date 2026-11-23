import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  type HostTypeCreateFieldsProps,
  type I18n,
  loreDocsUrl,
  OutboundLink,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Fingerprint, KeyRound } from "lucide-react";

import { cloudflareTokenTemplateUrl } from "../../../../api/schemas/cloudflareTokenTemplate.ts";

/**
 * What a `cloudflare` host's create asks for (#E166): the account id and the
 * token, with the link that mints one. Ship's, registered on core's
 * `HostTypeUiRegistry`, so the token template stays beside the probes it is
 * pinned to.
 */
const CloudflareHostCreateFields = (props: HostTypeCreateFieldsProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <>
      <div className="flex flex-col gap-1">
        <Control
          input={props.form.input.accountId}
          label={tr("hosts.cloudflare.accountId")}
          // The hint used to float under the field with nothing tying
          // the two together; a Control puts it where it belongs.
          description={tr("hosts.cloudflare.accountId.hint")}
          icon={Fingerprint}
          placeholder={tr("hosts.cloudflare.accountId.placeholder")}
          disabled={props.busy}
          // Not clearable: an optional text field grows a clear button,
          // and this one is required the moment Cloudflare is picked -
          // it is optional in the SCHEMA only because a bay host has
          // no such field at all.
          clearable={false}
          inputProps={{
            "data-testid": "host-create-account",
            "aria-invalid": Boolean(props.errorFor("accountId")) || undefined,
          }}
        />
        {/* ⚠️ Below the control rather than in its `description`, and
                still `text-danger-text`. `Control` takes its error from the
                form's own validation state and offers no prop for one, so a
                SERVER refusal routed through `description` would render in
                muted grey - a refusal that does not look like one. */}
        {props.errorFor("accountId") && (
          <span
            className="text-danger-text text-xs"
            data-testid="host-create-account-error"
          >
            {props.errorFor("accountId")}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Control
          password
          input={props.form.input.token}
          label={tr("hosts.cloudflare.token")}
          icon={KeyRound}
          placeholder={tr("hosts.cloudflare.token.placeholder")}
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
            "data-testid": "host-create-token",
            "aria-invalid": Boolean(props.errorFor("token")) || undefined,
          }}
        />
        {/* Same reasoning as the account id above. */}
        {props.errorFor("token") && (
          <span
            className="text-danger-text text-xs"
            data-testid="host-create-token-error"
          >
            {props.errorFor("token")}
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
              className={cn(
                textLinkUnderlineClassName,
                "hover:text-foreground",
              )}
              data-testid="host-create-mint"
            >
              {tr("hosts.cloudflare.mint")}
            </OutboundLink>
            {/* The guide is the onboarding, not a footnote: which
                    template to start from, and the two permissions it
                    lacks. */}
            <OutboundLink
              // ⚠️ Absolute, through `loreDocsUrl`. Written
              // root-relative it resolved against Lore's own origin and
              // 404'd (feedback #P2142).
              href={loreDocsUrl("ship-cloudflare-token")}
              className={cn(
                textLinkUnderlineClassName,
                "hover:text-foreground",
              )}
              data-testid="host-create-guide"
            >
              {tr("hosts.cloudflare.guide")}
            </OutboundLink>
          </span>
          {/* ⚠️ Said out loud because the link is NOT scoped:
                  `accountId=*` pre-selects All accounts, and whether a real
                  account id narrows the form has not been tested against a
                  live dashboard. Claiming a scope we have not verified
                  would be worse than the tedium being removed. */}
          <span>{tr("hosts.cloudflare.mint.scope")}</span>
        </span>
      </div>
    </>
  );
};

export default CloudflareHostCreateFields;
