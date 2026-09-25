import { z } from "alepha";
import type {
  ApiKeyController,
  ApiKeyStatus,
  ListApiKeyItem,
} from "alepha/api/keys";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Check,
  CircleDot,
  Clipboard,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Button } from "../core/Button.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../core/Dialog.tsx";
import TimeAgo from "../core/TimeAgo.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { DataTable } from "../table/DataTable.tsx";
import type { DataTableFilterFields } from "../table/dataTableTypes.ts";
import { AccountPage } from "./AccountPage.tsx";
import { ApiKeyCreateDialog } from "./ApiKeyCreateDialog.tsx";
import { ApiKeyScopeSummary } from "./ApiKeyScopeSummary.tsx";
import { ApiKeyStatusBadge } from "./ApiKeyStatusBadge.tsx";

export interface AccountKeysProps {
  /**
   * The rows `GET /api-keys` returns, live and dead: the framework's own
   * response type, so a field added to the endpoint is available here the
   * day it lands.
   */
  apiKeys?: ListApiKeyItem[];
}

/**
 * The key statuses the filter offers, in order. A local list checked against
 * `ApiKeyStatus` rather than the schema, for the bundle reason `AdminKeys`
 * gives.
 */
const API_KEY_STATUSES = [
  "active",
  "expiring",
  "expired",
  "revoked",
] as const satisfies readonly ApiKeyStatus[];

/**
 * Your own API keys: mint, rotate, revoke, and see where each is in its life,
 * as a `DataTable` over the list the route loader fetched.
 *
 * `listApiKeys` returns the whole list unpaginated, so the table is handed
 * the array (`data`) and pages, sorts and filters it in memory. A write
 * re-reads the list, because a revoked key stays listed with its status.
 *
 * The status filter starts on the live keys (active and expiring). Expired
 * and revoked keys are one filter change away: listed because a key that
 * stopped working is the one a user comes looking for, filtered out by
 * default because a table that reads "14 keys" when 11 are dead misleads.
 *
 * The freshly created or rotated token is shown **once**, in a dialog that
 * stays open until dismissed, because the server stores only a hash and
 * cannot show it again. That is also why minting and the reveal are separate
 * steps: a token that scrolls out of view behind a re-render is gone.
 */
const AccountKeys = (props: AccountKeysProps) => {
  const api = useClient<ApiKeyController>();
  const dialog = useDialog();
  const { tr } = useI18n();

  const [keys, setKeys] = useState<ListApiKeyItem[]>(props.apiKeys ?? []);
  const [createOpen, setCreateOpen] = useState(false);
  const [freshToken, setFreshToken] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  const statusLabel = (status: ApiKeyStatus): string => {
    switch (status) {
      case "active":
        return tr("account.keys.status.active", { default: "Active" });
      case "expiring":
        return tr("account.keys.status.expiringLabel", { default: "Expiring" });
      case "expired":
        return tr("account.keys.status.expired", { default: "Expired" });
      case "revoked":
        return tr("account.keys.status.revoked", { default: "Revoked" });
    }
  };

  const filterFields = {
    status: {
      schema: z.array(z.enum(API_KEY_STATUSES)),
      mode: "default",
      label: tr("account.keys.colStatus", { default: "Status" }),
      icon: CircleDot,
      optionLabel: statusLabel,
      control: {
        clearLabel: tr("account.keys.statusAll", { default: "All statuses" }),
      },
    },
  } satisfies DataTableFilterFields;

  const reload = async () => {
    setKeys((await api.listApiKeys()) as ListApiKeyItem[]);
  };

  const rotate = useAction<[key: ListApiKeyItem], boolean>(
    {
      handler: async (key) => {
        const ok = await dialog.confirm({
          title: tr("account.keys.rotateTitle", {
            default: "Rotate $1?",
            args: [key.name],
          }),
          description: tr("account.keys.rotateDescription", {
            default:
              "The current secret stops working immediately, and a new one is shown once. Update wherever the key is stored.",
          }),
          confirmLabel: tr("account.keys.rotate", { default: "Rotate" }),
        });
        if (!ok) {
          return false;
        }
        const rotated: any = await api.rotateMyApiKey({
          params: { id: key.id },
          body: {},
        });
        setFreshToken(rotated.token);
        await reload();
        return true;
      },
    },
    [api, dialog, tr],
  );

  const revoke = useAction<[key: ListApiKeyItem], boolean>(
    {
      handler: async (key) => {
        const ok = await dialog.confirm({
          title: tr("account.keys.revokeTitle", {
            default: "Revoke $1?",
            args: [key.name],
          }),
          description: tr("account.keys.revokeDescription", {
            default:
              "Anything still using this key stops working immediately. This cannot be undone.",
          }),
          confirmLabel: tr("account.keys.revoke", { default: "Revoke" }),
          destructive: true,
        });
        if (!ok) {
          return false;
        }
        await api.revokeMyApiKey({ params: { id: key.id } });
        // Re-read rather than drop the row: a revoked key stays listed, with
        // its status, until the retention window purges it.
        await reload();
        return true;
      },
    },
    [api, dialog, tr],
  );

  const busy = rotate.loading || revoke.loading;

  const copy = async () => {
    if (!freshToken) {
      return;
    }
    await navigator.clipboard.writeText(freshToken);
    setCopied(true);
  };

  return (
    <AccountPage variant="table">
      <DataTable<ListApiKeyItem, typeof filterFields>
        className="min-h-0 flex-1"
        data={keys}
        rowKey={(key) => key.id}
        filter={(key, filters) =>
          !filters.status?.length || filters.status.includes(key.status)
        }
        filters={{
          fields: filterFields,
          // The live keys first; dead ones are one filter change away.
          initialValues: { status: ["active", "expiring"] },
        }}
        actions={[
          {
            icon: Plus,
            label: tr("account.keys.new", { default: "New key" }),
            primary: true,
            disabled: busy,
            onClick: () => setCreateOpen(true),
          },
        ]}
        emptyState={{
          icon: KeyRound,
          title: tr("account.keys.title", { default: "API keys" }),
          description: tr("account.keys.description", {
            default: "Keys act as you. Revoke any you no longer recognise.",
          }),
        }}
        columns={{
          name: {
            label: tr("account.keys.colName", { default: "Name" }),
            sortable: true,
            cell: (key) => (
              <div className="flex min-w-0 flex-col">
                <span className="font-medium" data-testid="account-key-name">
                  {key.name}
                </span>
                {key.description ? (
                  <span className="text-muted-foreground truncate text-xs">
                    {key.description}
                  </span>
                ) : null}
              </div>
            ),
          },
          token: {
            label: tr("account.keys.colToken", { default: "Token" }),
            cell: (key) => (
              <code className="text-xs">
                {key.tokenPrefix}…{key.tokenSuffix}
              </code>
            ),
          },
          permissions: {
            label: tr("account.keys.colScope", { default: "Scope" }),
            cell: (key) => <ApiKeyScopeSummary permissions={key.permissions} />,
          },
          status: {
            label: tr("account.keys.colStatus", { default: "Status" }),
            // The Expires column beside it carries the date.
            cell: (key) => <ApiKeyStatusBadge apiKey={key} labelOnly />,
          },
          createdAt: {
            label: tr("account.keys.colCreated", { default: "Created" }),
            sortable: true,
            cell: (key) => (
              <TimeAgo
                value={key.createdAt}
                className="text-muted-foreground text-xs"
              />
            ),
          },
          lastUsedAt: {
            label: tr("account.keys.colLastUsed", { default: "Last used" }),
            sortable: true,
            cell: (key) =>
              key.lastUsedAt ? (
                <TimeAgo
                  value={key.lastUsedAt}
                  className="text-muted-foreground text-xs"
                />
              ) : (
                <span className="text-muted-foreground text-xs">
                  {tr("account.keys.never", { default: "Never" })}
                </span>
              ),
          },
          expiresAt: {
            label: tr("account.keys.colExpires", { default: "Expires" }),
            sortable: true,
            cell: (key) =>
              key.expiresAt ? (
                <TimeAgo
                  value={key.expiresAt}
                  className="text-muted-foreground text-xs"
                />
              ) : (
                <span className="text-muted-foreground text-xs">
                  {tr("account.keys.never", { default: "Never" })}
                </span>
              ),
          },
          /*
            Read-only, set when the key was created through the API: shown so
            a key refusing requests from a new address can be diagnosed here.
          */
          ipAllowlist: {
            label: tr("account.keys.colIpAllowlist", {
              default: "Allowed from",
            }),
            defaultHidden: true,
            cell: (key) =>
              key.ipAllowlist.length ? (
                <code className="text-xs">{key.ipAllowlist.join(", ")}</code>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {tr("account.keys.ipAnywhere", { default: "Anywhere" })}
                </span>
              ),
          },
        }}
        /*
          Rotate on a live or an expired key (rotating an expired key is how
          it is renewed), revoke on a live key only, nothing on a revoked
          one: it keeps its row, with its status and usage.
        */
        rowActions={(key) => [
          ...(key.status === "revoked"
            ? []
            : [
                {
                  label: tr("account.keys.rotate", { default: "Rotate" }),
                  icon: RefreshCw,
                  disabled: () => busy,
                  onClick: () => void rotate.run(key),
                },
              ]),
          ...(key.status === "revoked" || key.status === "expired"
            ? []
            : [
                {
                  label: tr("account.keys.revoke", { default: "Revoke" }),
                  icon: Trash2,
                  destructive: true,
                  disabled: () => busy,
                  onClick: () => void revoke.run(key),
                },
              ]),
        ]}
      />

      <ApiKeyCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        existingKeys={keys}
        onCreated={async (token) => {
          setFreshToken(token);
          await reload();
        }}
      />

      {/* Deliberately not auto-dismissed: this is the only time the token
          exists in a readable form. */}
      <Dialog
        open={Boolean(freshToken)}
        onOpenChange={(next) => {
          if (!next) {
            setFreshToken(undefined);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("account.keys.revealTitle", { default: "Copy your key now" })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <span className="text-muted-foreground text-sm">
              {tr("account.keys.revealDescription", {
                default:
                  "This is the only time it is shown. Store it somewhere safe before closing this dialog.",
              })}
            </span>
            <code className="bg-muted rounded-md border p-3 font-mono text-xs break-all">
              {freshToken}
            </code>
            <DialogFooter>
              <Button variant="solid" intent="none" onClick={copy}>
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Clipboard className="size-4" />
                )}
                {copied
                  ? tr("account.keys.copied", { default: "Copied" })
                  : tr("account.keys.copy", { default: "Copy" })}
              </Button>
              <Button
                onClick={() => {
                  setFreshToken(undefined);
                  setCopied(false);
                }}
              >
                {tr("account.keys.done", { default: "Done" })}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </AccountPage>
  );
};

export default AccountKeys;
