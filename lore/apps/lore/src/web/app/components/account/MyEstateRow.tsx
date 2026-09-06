import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { ChevronRight } from "lucide-react";

import type { OwnedEstateResource } from "@/api/schemas/ownedEstateResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface MyEstateRowProps {
  estate: OwnedEstateResource;
  onOpen: () => void;
}

/**
 * One estate, at a glance: what it is called, what kind it is, whether it is
 * connected, and whether it may deploy.
 *
 * Four facts and nothing else. The card this replaced carried the switches,
 * the interval, the loans, the command list and both destructive actions all
 * expanded (feedback #2110): readable with one estate, unusable with three.
 * Everything else moved to the drawer this row opens.
 *
 * ⚠️ The secret prefix stays TRUNCATED here, and in the drawer. It names the
 * credential so the owner can tell two apart; it is not the credential, and
 * the cleartext cannot be shown again at all - see `MyEstateSecretDialog`.
 *
 * A `button`, not a row with a click handler: it opens a panel, which is
 * what a button does, and it is reachable by keyboard for free.
 */
const MyEstateRow = (props: MyEstateRowProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const estate = props.estate;

  return (
    <button
      type="button"
      onClick={props.onOpen}
      data-testid="my-estate-row"
      className="hover:bg-muted/60 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
    >
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate" data-testid="my-estate-slug">
            {estate.slug}
          </span>
          {estate.label && (
            <span className="text-muted-foreground truncate text-xs font-normal">
              {estate.label}
            </span>
          )}
          <Badge variant="outline">{estate.type}</Badge>
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {estate.secretPrefix &&
            (estate.type === "cloudflare"
              ? tr("account.estates.tokenPrefix", {
                  args: [estate.secretPrefix],
                })
              : tr("account.estates.secretPrefix", {
                  args: [estate.secretPrefix],
                }))}
          {estate.secretPrefix && " · "}
          {estate.type === "cloudflare"
            ? estate.credentialCheckedAt
              ? tr("estates.credential.checked", {
                  args: [
                    String(l(estate.credentialCheckedAt, { date: "lll" })),
                  ],
                })
              : tr("estates.credential.neverChecked")
            : estate.lastSeenAt
              ? tr("estates.lastSeen", {
                  args: [String(l(estate.lastSeenAt, { date: "lll" }))],
                })
              : tr("estates.neverSeen")}
        </span>
      </span>
      {/* A cloudflare account never connects, so `online` is always false
          on it and says nothing. What a person needs there is whether the
          credential still works (#1630). Read as optional: a bay row has no
          status and must not be given one. */}
      {estate.type === "cloudflare" ? (
        <Badge
          variant={
            estate.credentialStatus === "valid" ? "default" : "destructive"
          }
          data-testid="my-estate-credential-status"
        >
          {estate.credentialStatus === "valid"
            ? tr("estates.credential.valid")
            : tr("estates.credential.invalid")}
        </Badge>
      ) : (
        <Badge variant={estate.online ? "default" : "outline"}>
          {estate.online ? tr("estates.online") : tr("estates.offline")}
        </Badge>
      )}
      <Badge variant="secondary">
        {estate.deployAllowed
          ? tr("estates.deploys.allowed")
          : tr("estates.deploys.statsOnly")}
      </Badge>
      <ChevronRight
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    </button>
  );
};

export default MyEstateRow;
