import {
  Button,
  cn,
  Input,
  textLinkUnderlineClassName,
  useToast,
} from "@alepha/ui";
import type { HostController } from "@lore/core/api";
import {
  hostErrorMessage,
  type HostTypeDrawerSectionProps,
  type I18n,
  OutboundLink,
} from "@lore/core/web";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";

import { cloudflareTokenTemplateUrl } from "../../../../api/schemas/cloudflareTokenTemplate.ts";

/**
 * A `cloudflare` host's section of its drawer (#E166): when its token was
 * last checked, the error it answered, and replacing or checking it again.
 * Ship's, registered on core's `HostTypeUiRegistry`. The token lives only as
 * long as this section, keyed by host, never prefilled and never echoed.
 */
const CloudflareHostDrawerSection = (props: HostTypeDrawerSectionProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const toaster = useToast();
  const api = useClient<HostController>();
  const [token, setToken] = useState("");
  const [credentialError, setCredentialError] = useState<string | undefined>();

  /**
   * Replaces the pasted token, all or nothing.
   *
   * Nothing is revealed afterwards: this is a write, not a mint. The field
   * is a password input with autocomplete off for the same reason the
   * create dialog's is.
   */
  const replaceAction = useAction<[], void>(
    {
      handler: async () => {
        if (!props.host || !token.trim()) return;
        setCredentialError(undefined);
        const updated = await api.replaceHostCredential({
          params: { hostId: props.host.id },
          body: { token: token.trim() },
        });
        setToken("");
        props.onChanged({ ...updated, projects: props.host.projects });
        toaster.success(tr("hosts.credential.replaced"));
      },
      // Beside the field, not a toast: a refusal here names a permission the
      // owner has to add at Cloudflare, and it has to still be on screen
      // while they go and do it.
      onError: (error) => setCredentialError(hostErrorMessage(error)),
    },
    [api, props.host, token, props.onChanged, toaster, tr],
  );

  /**
   * Ask Cloudflare again, now, rather than waiting for the nightly sweep.
   */
  const recheckAction = useAction<[], void>(
    {
      handler: async () => {
        if (!props.host) return;
        setCredentialError(undefined);
        const updated = await api.checkHostCredential({
          params: { hostId: props.host.id },
        });
        props.onChanged({ ...updated, projects: props.host.projects });
        toaster.success(tr("hosts.credential.checkedNow"));
      },
      onError: (error) => setCredentialError(hostErrorMessage(error)),
    },
    [api, props.host, props.onChanged, toaster, tr],
  );

  const replace = replaceAction.run;
  const recheck = recheckAction.run;
  const busy = props.busy || replaceAction.loading || recheckAction.loading;

  return (
    <div className="flex flex-col gap-3 border-t px-4 pt-4">
      <span className="text-muted-foreground text-xs">
        {props.host.credentialCheckedAt
          ? tr("hosts.credential.checked", {
              args: [l(props.host.credentialCheckedAt, { date: "lll" })],
            })
          : tr("hosts.credential.neverChecked")}
        {props.host.credentialExpiresAt &&
          ` · ${tr("hosts.credential.expires", {
            args: [l(props.host.credentialExpiresAt, { date: "lll" })],
          })}`}
      </span>

      {props.host.credentialError && (
        <span
          className="text-danger-text text-xs"
          data-testid="my-host-credential-error"
        >
          {props.host.credentialError}
        </span>
      )}

      <div className="flex flex-col gap-1">
        <Input
          type="password"
          autoComplete="off"
          value={token}
          disabled={!props.canUpdate || busy}
          onChange={(event) => setToken(event.target.value)}
          placeholder={tr("hosts.cloudflare.token.placeholder")}
          aria-label={tr("hosts.credential.replace")}
          maxLength={128}
          data-testid="my-host-token"
        />
        {/* ⚠️ Same six permissions as a first mint, so the same
                      link: a lapsed token is replaced by one exactly like
                      the one it replaces, and re-adding six rows by hand is
                      where this went wrong the first time. Unscoped for the
                      reason `cloudflareTokenTemplateUrl` records - the
                      host's account id is known here, but whether the
                      parameter narrows the form is untested. */}
        <span className="text-muted-foreground text-xs">
          <OutboundLink
            href={cloudflareTokenTemplateUrl()}
            className={cn(textLinkUnderlineClassName, "hover:text-foreground")}
            data-testid="my-host-token-mint"
          >
            {tr("hosts.cloudflare.mint")}
          </OutboundLink>
        </span>
        {credentialError && (
          <span
            className="text-danger-text text-xs"
            data-testid="my-host-credential-action-error"
          >
            {credentialError}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outlined"
          size="sm"
          disabled={!props.canUpdate || busy || token.trim().length < 40}
          loading={replaceAction.loading}
          onClick={() => {
            void replace();
          }}
          data-testid="my-host-replace"
        >
          <KeyRound className="size-4" />
          {tr("hosts.credential.replace")}
        </Button>
        <Button
          variant="minimal"
          size="sm"
          disabled={!props.canUpdate || busy}
          loading={recheckAction.loading}
          onClick={() => {
            void recheck();
          }}
          data-testid="my-host-recheck"
        >
          <RefreshCw className="size-4" />
          {tr("hosts.credential.check")}
        </Button>
      </div>
    </div>
  );
};

export default CloudflareHostDrawerSection;
