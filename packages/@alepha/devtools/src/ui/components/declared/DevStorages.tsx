import { HardDrive } from "lucide-react";
import type { DevStorageMetadata } from "../../../schemas/DevStorageMetadata.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { DeclaredScreen } from "./DeclaredScreen.tsx";
import { DetailFields } from "./DetailFields.tsx";

/**
 * `maxSize` is declared in **megabytes**, not bytes. This used to run the
 * value through a bytes formatter, so a 2 MB cap rendered as "2 B".
 */
const formatMegabytes = (mb?: number): string | undefined => {
  if (mb === undefined) return undefined;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
};

/**
 * File storages declared with `$storage` — accepted MIME types, size ceiling,
 * default retention and backing provider.
 */
export const DevStorages = () => {
  const meta = useMetadata();
  const items = meta.data?.storages ?? [];

  return (
    <DeclaredScreen<DevStorageMetadata>
      items={items}
      keyOf={(s) => s.name}
      labelOf={(s) => s.name}
      metaOf={(s) => s.provider}
      icon={HardDrive}
      filterPlaceholder="Filter storages…"
      emptyHint="Use $storage to declare a place to keep files"
      renderDetail={(s) => (
        <div>
          <div style={{ padding: "14px 14px 10px" }}>
            <div className="dt-mono" style={{ fontSize: 14 }}>
              {s.name}
            </div>
            {s.description && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: "var(--dt-fg-dim)",
                }}
              >
                {s.description}
              </div>
            )}
          </div>

          <div className="dt-section-label">Definition</div>
          <DetailFields
            fields={[
              { label: "Provider", value: s.provider },
              {
                label: "Max size",
                value: formatMegabytes(s.maxSize) ?? "10 MB (default)",
              },
              {
                label: "Retention",
                value: s.ttl ? `expires after ${s.ttl}` : "kept until deleted",
              },
              {
                label: "Accepted types",
                value: s.mimeTypes?.length
                  ? `${s.mimeTypes.length} declared`
                  : "any",
              },
            ]}
          />

          {s.mimeTypes && s.mimeTypes.length > 0 && (
            <>
              <div className="dt-section-label">MIME types</div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  padding: "10px 14px",
                }}
              >
                {s.mimeTypes.map((m) => (
                  <span key={m} className="dt-chip">
                    {m}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    />
  );
};

export default DevStorages;
