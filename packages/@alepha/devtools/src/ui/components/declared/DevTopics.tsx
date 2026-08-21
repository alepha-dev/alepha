import { Radio } from "lucide-react";

import type { DevTopicMetadata } from "../../../schemas/DevTopicMetadata.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { SchemaTree } from "../shared/SchemaTree.tsx";
import { DeclaredScreen } from "./DeclaredScreen.tsx";
import { DetailFields } from "./DetailFields.tsx";

/**
 * Topics declared with `$topic`, including the published message schema.
 */
export const DevTopics = () => {
  const meta = useMetadata();
  const items = meta.data?.topics ?? [];

  return (
    <DeclaredScreen<DevTopicMetadata>
      items={items}
      keyOf={(t) => t.name}
      labelOf={(t) => t.name}
      metaOf={(t) => `${t.subscribers}`}
      icon={Radio}
      filterPlaceholder="Filter topics…"
      emptyHint="Use $topic to declare a pub/sub topic"
      renderDetail={(t) => (
        <div>
          <div style={{ padding: "14px 14px 10px" }}>
            <div className="dt-mono" style={{ fontSize: 14 }}>
              {t.name}
            </div>
            {t.description && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: "var(--dt-fg-dim)",
                }}
              >
                {t.description}
              </div>
            )}
          </div>

          <div className="dt-section-label">Definition</div>
          <DetailFields
            fields={[
              { label: "Provider", value: t.provider },
              {
                label: "Subscribers",
                value: `${t.subscribers} declared with $subscriber`,
              },
            ]}
          />

          <SchemaTree
            schema={t.schema}
            label="Message schema"
            rootName="message"
          />
        </div>
      )}
    />
  );
};

export default DevTopics;
