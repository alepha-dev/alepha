import { Button } from "@alepha/ui";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { OtaAdminController } from "../../ota-api/controllers/OtaAdminController.ts";
import type { OtaAppResource } from "../../ota-api/schemas/otaAppResourceSchema.ts";
import { OtaChannelCard } from "./OtaChannelCard.tsx";
import { OtaChannelCreateDialog } from "./OtaChannelCreateDialog.tsx";

export interface OtaChannelsTabProps {
  app: OtaAppResource;
}

/**
 * The app's channels, each with what it serves per compatibility cohort.
 */
export const OtaChannelsTab = (props: OtaChannelsTabProps) => {
  const client = useClient<OtaAdminController>();
  const { tr } = useI18n();
  const [creating, setCreating] = useState(false);
  const channels = useQuery(
    {
      key: ["ota-channels", props.app.id],
      handler: () => client.otaListChannels({ params: { id: props.app.id } }),
    },
    [client, props.app.id],
  );
  const bundles = useQuery(
    {
      key: ["ota-bundles", props.app.id],
      handler: () => client.otaListBundles({ params: { id: props.app.id } }),
    },
    [client, props.app.id],
  );

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus />
          {tr("ota.admin.channels.create", { default: "New channel" })}
        </Button>
      </div>
      {(channels.data ?? []).map((channel) => (
        <OtaChannelCard
          key={channel.id}
          app={props.app}
          channel={channel}
          bundles={bundles.data ?? []}
        />
      ))}
      <OtaChannelCreateDialog
        app={props.app}
        open={creating}
        onOpenChange={setCreating}
      />
    </div>
  );
};
