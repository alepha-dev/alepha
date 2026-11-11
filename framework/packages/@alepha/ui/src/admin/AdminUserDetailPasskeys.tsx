import type { IdentityResource } from "alepha/api/users";
import type { UseActionReturn } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Fingerprint, Trash2 } from "lucide-react";

import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../core/Card.tsx";

export interface AdminUserDetailPasskeysProps {
  /**
   * The user's passkey identities. Their `providerData` carries no public
   * key: the admin API strips it.
   */
  passkeys: ReadonlyArray<IdentityResource>;
  revokePasskey: UseActionReturn<[IdentityResource], void>;
  revokeAllPasskeys: UseActionReturn<[], void>;
}

/**
 * The user's passkeys, as their own group beside the password and the
 * connections: name, added and last used, synced or device-bound, and a
 * short fingerprint of the credential id (never the id itself). Revoke one,
 * or all of them for a lost phone.
 */
export const AdminUserDetailPasskeys = (
  props: AdminUserDetailPasskeysProps,
) => {
  const { l, tr } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {tr("admin.userDetail.passkeys", { default: "Passkeys" })}
        </CardTitle>
        <CardDescription>
          {tr("admin.userDetail.passkeysSub", {
            default:
              "Revoking a passkey does not sign the user out: revoke their sessions for that.",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {props.passkeys.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {tr("admin.userDetail.noPasskeys", { default: "No passkeys." })}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {props.passkeys.map((passkey) => {
              const data = (passkey.providerData ?? {}) as {
                name?: string;
                createdAt?: string;
                lastUsedAt?: string;
                backedUp?: boolean;
              };
              return (
                <li
                  key={passkey.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <Fingerprint className="size-5" />
                    <div className="flex flex-col">
                      <span className="inline-flex items-center gap-2 text-sm font-medium">
                        {data.name ?? passkey.provider}
                        <Badge>
                          {data.backedUp
                            ? tr("admin.userDetail.passkeySynced", {
                                default: "Synced",
                              })
                            : tr("admin.userDetail.passkeyDeviceBound", {
                                default: "Device-bound",
                              })}
                        </Badge>
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {data.lastUsedAt
                          ? tr("admin.userDetail.passkeyUsed", {
                              default: "Added $1, last used $2",
                              args: [
                                l(data.createdAt ?? passkey.createdAt, {
                                  date: "ll",
                                }),
                                l(data.lastUsedAt, { date: "ll" }),
                              ],
                            })
                          : tr("admin.userDetail.passkeyNeverUsed", {
                              default: "Added $1, never used",
                              args: [
                                l(data.createdAt ?? passkey.createdAt, {
                                  date: "ll",
                                }),
                              ],
                            })}
                        {" · "}
                        <span className="font-mono">
                          {credentialFingerprint(passkey.providerUserId ?? "")}
                        </span>
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outlined"
                    intent="danger"
                    size="sm"
                    loading={props.revokePasskey.loading}
                    onClick={() => props.revokePasskey.run(passkey)}
                  >
                    <Trash2 className="size-4" />
                    {tr("admin.userDetail.passkeyRevoke", {
                      default: "Revoke",
                    })}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {props.passkeys.length > 1 ? (
        <CardFooter>
          <Button
            variant="outlined"
            intent="danger"
            loading={props.revokeAllPasskeys.loading}
            onClick={() => props.revokeAllPasskeys.run()}
          >
            {tr("admin.userDetail.passkeyRevokeAll", {
              default: "Revoke all passkeys",
            })}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
};

/**
 * Eight hex digits (FNV-1a) that tell two credentials apart on screen and
 * say nothing of the id itself.
 */
const credentialFingerprint = (id: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, "0");
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
};
