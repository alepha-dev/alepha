import * as React from "react";

void React;

import { BrandIcon } from "@alepha/ui/components/brand-icon/brand-icon";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import type { IdentityResource } from "alepha/api/users";
import type { UseActionReturn } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { KeyRound, Trash2 } from "lucide-react";
import { PROVIDER_LABELS } from "../auth/provider-labels.ts";

export interface AdminUserDetailSecurityTabProps {
  /**
   * Whether a `credentials` identity exists — i.e. a password is set.
   */
  hasPassword: boolean;
  /**
   * Every identity except `credentials`, which has its own card.
   */
  socialIdentities: ReadonlyArray<IdentityResource>;
  removeIdentity: UseActionReturn<[IdentityResource], void>;
  onChangePassword: () => void;
}

/**
 * Security tab: password sign-in and linked OAuth providers.
 */
export const AdminUserDetailSecurityTab = (
  props: AdminUserDetailSecurityTabProps,
) => {
  const { tr } = useI18n();

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex max-w-6xl flex-col gap-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>
              {tr("admin.userDetail.credentials", {
                default: "Credentials",
              })}
            </CardTitle>
            <CardDescription>
              {tr("admin.userDetail.credentialsSub", {
                default: "Password sign-in for this account.",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {props.hasPassword
                ? tr("admin.userDetail.credentialsHasPassword", {
                    default:
                      "A password is set. You can't remove it, but you can set a new one.",
                  })
                : tr("admin.userDetail.credentialsNoPassword", {
                    default:
                      "No password is set yet. Set one so the user can sign in with a password.",
                  })}
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={props.onChangePassword}>
              <KeyRound className="size-4" />
              {props.hasPassword
                ? tr("admin.userDetail.changePassword", {
                    default: "Change password",
                  })
                : tr("admin.userDetail.setPassword", {
                    default: "Set password",
                  })}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {tr("admin.userDetail.identities", {
                default: "Connected accounts",
              })}
            </CardTitle>
            <CardDescription>
              {tr("admin.userDetail.identitiesSub", {
                default: "Linked OAuth providers.",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {props.socialIdentities.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {tr("admin.userDetail.noIdentities", {
                  default: "No connected accounts.",
                })}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {props.socialIdentities.map((id) => {
                  const label = PROVIDER_LABELS[id.provider] ?? id.provider;
                  return (
                    <li
                      key={id.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <BrandIcon provider={id.provider} className="size-5" />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{label}</span>
                          {id.providerUserId && (
                            <span className="text-muted-foreground font-mono text-xs">
                              {id.providerUserId}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        loading={props.removeIdentity.loading}
                        onClick={() => props.removeIdentity.run(id)}
                      >
                        <Trash2 className="size-4" />
                        {tr("admin.userDetail.remove", {
                          default: "Remove",
                        })}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
