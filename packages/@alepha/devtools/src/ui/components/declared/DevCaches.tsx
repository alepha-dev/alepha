import type { DevCacheMetadata } from "../../../schemas/DevCacheMetadata.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { DeclaredScreen } from "./DeclaredScreen.tsx";
import { DetailFields } from "./DetailFields.tsx";

const formatTtl = (ttl?: unknown): string => {
  if (ttl === undefined || ttl === null) return "no expiry";
  if (typeof ttl !== "number") return String(ttl);
  if (ttl < 60) return `${ttl}s`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}h`;
  return `${Math.floor(ttl / 86400)}d`;
};

/**
 * Caches declared with `$cache`.
 *
 * Definition only — entry counts and hit rates are runtime state, which
 * devtools v1 does not collect.
 */
export const DevCaches = () => {
  const meta = useMetadata();
  const items = meta.data?.caches ?? [];

  return (
    <DeclaredScreen<DevCacheMetadata>
      items={items}
      keyOf={(c) => c.name}
      labelOf={(c) => c.name}
      metaOf={(c) => formatTtl(c.ttl)}
      filterPlaceholder="Filter caches…"
      emptyHint="Use $cache to declare a cache container"
      renderDetail={(c) => (
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
              {c.name}
            </span>
            {c.disabled && (
              <span
                className="dt-chip"
                style={{
                  color: "var(--dt-error)",
                  borderColor: "var(--dt-error)",
                }}
              >
                disabled
              </span>
            )}
          </div>

          <div className="dt-section-label">Definition</div>
          <DetailFields
            fields={[
              { label: "Provider", value: c.provider },
              { label: "TTL", value: formatTtl(c.ttl) },
              { label: "Status", value: c.disabled ? "disabled" : "active" },
            ]}
          />
        </div>
      )}
    />
  );
};

export default DevCaches;
