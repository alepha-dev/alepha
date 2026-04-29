import { Badge } from "@alepha/ui/components/ui/badge";
import { Card } from "@alepha/ui/components/ui/card";

interface DevPanelQueueProps {
  queue: any;
}

export const DevPanelQueue = (props: DevPanelQueueProps) => {
  const queue = props.queue;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1 text-lg font-semibold">{queue.name}</p>
        {queue.description && (
          <p className="text-muted-foreground text-sm">{queue.description}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Queue</Badge>
        {queue.provider && <Badge variant="outline">{queue.provider}</Badge>}
      </div>

      {queue.schema && (
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
            Job Schema
          </p>
          <Card className="p-3">
            <pre className="overflow-auto text-xs">
              {JSON.stringify(queue.schema, null, 2)}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
};
