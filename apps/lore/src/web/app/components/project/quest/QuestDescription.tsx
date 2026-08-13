import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { useStore } from "alepha/react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { useWikiLinkRewrite } from "../../shared/useWikiLinkRewrite.ts";

export interface QuestDescriptionProps {
  quest: QuestResource;
  onEdit: () => void;
}

const QuestDescription = (props: QuestDescriptionProps) => {
  const content = props.quest.description ?? "";
  // The quest row carries the project's integer id; the links this produces
  // need its slug, which the surrounding project layout has already loaded.
  const [project] = useStore(currentProjectAtom);
  // Resolve `[[#N]]` / `[[quest:#N]]` wiki-links into clickable links —
  // same syntax the folio view renders.
  const { content: rendered } = useWikiLinkRewrite(
    content,
    props.quest.projectId,
    project?.slug,
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
