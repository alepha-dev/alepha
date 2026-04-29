import { Badge } from "@alepha/ui/components/ui/badge";
import { Card } from "@alepha/ui/components/ui/card";

interface DevPanelTopicProps {
  topic: any;
}

export const DevPanelTopic = (props: DevPanelTopicProps) => {
  const topic = props.topic;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1 text-lg font-semibold">{topic.name}</p>
        {topic.description && (
          <p className="text-muted-foreground text-sm">{topic.description}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Topic</Badge>
        {topic.provider && <Badge variant="outline">{topic.provider}</Badge>}
        {topic.subscribers > 0 && (
          <Badge variant="secondary">
            {topic.subscribers} subscriber{topic.subscribers !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {topic.schema && (
        <div>
          <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
            Message Schema
          </p>
          <Card className="p-3">
            <pre className="overflow-auto text-xs">
              {JSON.stringify(topic.schema, null, 2)}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
};
