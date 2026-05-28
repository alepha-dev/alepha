import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { useWikiLinkRewrite } from "../../shared/useWikiLinkRewrite.ts";

export interface QuestDescriptionProps {
  quest: QuestResource;
  onEdit: () => void;
}

const QuestDescription = (props: QuestDescriptionProps) => {
  const content = props.quest.description ?? "";
  // Resolve `[[#N]]` / `[[quest:#N]]` wiki-links into clickable links —
  // same syntax the folio view renders.
  const { content: rendered } = useWikiLinkRewrite(
    content,
    props.quest.campaignId,
  );

  return (
    <div className="bg-muted border-border rounded-md border p-3 px-4">
      {content ? (
        <MarkdownView content={rendered} />
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
