import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

export interface QuestDescriptionProps {
  quest: QuestResource;
  onEdit: () => void;
}

const QuestDescription = (props: QuestDescriptionProps) => {
  const content = props.quest.description ?? "";

  return (
    <div className="bg-muted border-border rounded-md border p-3 px-4">
      {content ? (
        <MarkdownView content={content} />
      ) : (
        <button
          type="button"
          onClick={props.onEdit}
          className="text-muted-foreground text-sm italic hover:underline"
        >
          (no description)
        </button>
      )}
    </div>
  );
};

export default QuestDescription;
