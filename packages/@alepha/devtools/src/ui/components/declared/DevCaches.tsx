import { Boxes } from "lucide-react";

import type { DevCacheMetadata } from "../../../schemas/DevCacheMetadata.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { toText } from "../shared/toText.ts";
import { DeclaredScreen } from "./DeclaredScreen.tsx";
import { DetailFields } from "./DetailFields.tsx";

/**
 * A bare number is milliseconds (what `$cache` hands to the datetime
 * provider); a tuple is `[amount, unit]`. Rendering the number as seconds
 * showed a one-minute cache as "16h".
 */
const formatTtl = (ttl?: unknown): string => {
  if (ttl === undefined || ttl === null) return "no expiry";
  if (Array.isArray(ttl)) return ttl.join(" ");
  if (typeof ttl !== "number") return toText(ttl);
  const seconds = Math.round(ttl / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
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
      icon={Boxes}
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
