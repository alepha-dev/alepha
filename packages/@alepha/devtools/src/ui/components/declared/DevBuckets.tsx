import type { DevBucketMetadata } from "../../../schemas/DevBucketMetadata.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { DeclaredScreen } from "./DeclaredScreen.tsx";
import { DetailFields } from "./DetailFields.tsx";

const formatBytes = (bytes?: number): string | undefined => {
  if (bytes === undefined) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * File buckets declared with `$bucket` — accepted MIME types, size ceiling and
 * backing provider.
 */
export const DevBuckets = () => {
  const meta = useMetadata();
  const items = meta.data?.buckets ?? [];

  return (
    <DeclaredScreen<DevBucketMetadata>
      items={items}
      keyOf={(b) => b.name}
      labelOf={(b) => b.name}
      metaOf={(b) => b.provider}
      filterPlaceholder="Filter buckets…"
      emptyHint="Use $bucket to declare a file bucket"
      renderDetail={(b) => (
        <div>
          <div style={{ padding: "14px 14px 10px" }}>
            <div className="dt-mono" style={{ fontSize: 14 }}>
              {b.name}
            </div>
            {b.description && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: "var(--dt-fg-dim)",
                }}
              >
                {b.description}
              </div>
            )}
          </div>

          <div className="dt-section-label">Definition</div>
          <DetailFields
            fields={[
              { label: "Provider", value: b.provider },
              {
                label: "Max size",
                value: formatBytes(b.maxSize) ?? "unbounded",
              },
              {
                label: "Accepted types",
                value: b.mimeTypes?.length
                  ? `${b.mimeTypes.length} declared`
                  : "any",
              },
            ]}
          />

          {b.mimeTypes && b.mimeTypes.length > 0 && (
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
                {b.mimeTypes.map((m) => (
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

export default DevBuckets;
