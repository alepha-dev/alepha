import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { MyConnection, MyConnectionController } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { Plug } from "lucide-react";
import { useState } from "react";

export interface AccountConnectionsProps {
  connections?: MyConnection[];
}

/**
 * Applications holding access to this account through OAuth — an MCP client,
 * a CLI, a third-party integration.
 *
 * Confirmed on revoke, unlike a plain session. A session comes back by
 * signing in again; a connection comes back only by re-running whatever
 * authorization flow created it, which for an MCP client means the person has
 * to go and reconnect it from the other side.
 */
const AccountConnections = (props: AccountConnectionsProps) => {
  const api = useClient<MyConnectionController>();
  const dt = useInject(DateTimeProvider);
  const dialog = useDialog();
  const toaster = useToast();

  const [connections, setConnections] = useState<MyConnection[]>(
    props.connections ?? [],
  );

  const revoke = async (connection: MyConnection) => {
    const ok = await dialog.confirm({
      title: `Disconnect ${connection.clientName}?`,
      description:
        "It loses access immediately and has to be authorized again to come back.",
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!ok) {
      return;
    }
    try {
      await api.revokeMyConnection({ params: { id: connection.id } });
      setConnections((prev) => prev.filter((it) => it.id !== connection.id));
    } catch (error: any) {
      toaster.show(error?.message ?? "Could not disconnect it", "danger");
    }
  };

  if (connections.length === 0) {
    /*
      Same title AND description as the populated branch below. An empty page
      that drops its description reads as a different page, and the sentence is
      exactly what a reader with nothing on screen needs.
    */
    return (
      <SettingsSection
        title="Connected apps"
        description="Applications that can act on your behalf."
      >
        <SettingsRow
          label={
            <span className="flex items-center gap-2 text-muted-foreground">
              <Plug className="size-4" />
              Nothing is connected
            </span>
          }
          description="Applications you authorize will appear here."
        />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Connected apps"
      description="Applications that can act on your behalf."
    >
      {connections.map((connection) => (
        <SettingsRow
          key={connection.id}
          label={
            <span className="flex items-center gap-2">
              {connection.clientName}
              {connection.current ? (
                <span className="text-muted-foreground text-xs">
                  (this one)
                </span>
              ) : null}
            </span>
          }
          description={`Connected ${dt.of(connection.createdAt).fromNow()}${
            connection.lastUsedAt
              ? ` · last used ${dt.of(connection.lastUsedAt).fromNow()}`
              : " · never used"
          }`}
        >
          <Button variant="ghost" size="sm" onClick={() => revoke(connection)}>
            Disconnect
          </Button>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
};

export default AccountConnections;
