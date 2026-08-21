import { ShieldCheck } from "lucide-react";

import type { DevRealmMetadata } from "../../../schemas/DevRealmMetadata.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { toText } from "../shared/toText.ts";
import { DeclaredScreen } from "./DeclaredScreen.tsx";
import { DetailFields } from "./DetailFields.tsx";

const check = (on?: boolean) => (on ? "declared" : "—");

/**
 * Token expirations are declared as a `[value, unit]` tuple. Stringifying one
 * directly yields `15,minutes`; join it so it reads as `15 minutes`.
 */
const formatDuration = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.join(" ");
  return toText(value);
};

/**
 * Security realms declared with `$issuer` — roles, token lifetimes and which
 * session hooks the application implements. Collected since the first version
 * of the metadata provider and never rendered until now.
 */
export const DevRealms = () => {
  const meta = useMetadata();
  const items = meta.data?.realms ?? [];

  return (
    <DeclaredScreen<DevRealmMetadata>
      items={items}
      keyOf={(r) => r.name}
      labelOf={(r) => r.name}
      metaOf={(r) => r.type}
      icon={ShieldCheck}
      filterPlaceholder="Filter realms…"
      emptyHint="Use $issuer to declare a security realm"
      renderDetail={(r) => (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 14px 10px",
            }}
          >
            <span className="dt-mono" style={{ fontSize: 14 }}>
              {r.name}
            </span>
            <span className="dt-chip" data-tone="accent">
              {r.type}
            </span>
          </div>

          {r.description && (
            <div
              style={{
                padding: "0 14px 12px",
                fontSize: 12,
                color: "var(--dt-fg-dim)",
              }}
            >
              {r.description}
            </div>
          )}

          {r.roles && r.roles.length > 0 && (
            <>
              <div className="dt-section-label">Roles</div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  padding: "10px 14px",
                }}
              >
                {r.roles.map((role: any) => (
                  <span key={String(role?.name ?? role)} className="dt-chip">
                    {String(role?.name ?? role)}
                  </span>
                ))}
              </div>
            </>
          )}

          <div className="dt-section-label">Tokens</div>
          <DetailFields
            fields={[
              {
                label: "Access token expiry",
                value: formatDuration(r.settings?.accessTokenExpiration),
              },
              {
                label: "Refresh token expiry",
                value: formatDuration(r.settings?.refreshTokenExpiration),
              },
            ]}
          />

          <div className="dt-section-label">Session hooks</div>
          <DetailFields
            fields={[
              {
                label: "onCreateSession",
                value: check(r.settings?.hasOnCreateSession),
              },
              {
                label: "onRefreshSession",
                value: check(r.settings?.hasOnRefreshSession),
              },
              {
                label: "onDeleteSession",
                value: check(r.settings?.hasOnDeleteSession),
              },
            ]}
          />
        </div>
      )}
    />
  );
};

export default DevRealms;
