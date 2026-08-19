import { useStore } from "alepha/react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import LoreViewer from "../../shared/element/LoreViewer.tsx";

export interface QuestDescriptionProps {
  quest: QuestResource;
  onEdit: () => void;
}

const QuestDescription = (props: QuestDescriptionProps) => {
  const content = props.quest.description ?? "";
  // The quest row carries the project's integer id; the links this produces
  // need its slug, which the surrounding project layout has already loaded.
  const [project] = useStore(currentProjectAtom);

  return (
    <div className="bg-muted border-border rounded-md border p-3 px-4">
      {content ? (
        <LoreViewer
          element={{
            kind: "quest",
            projectId: props.quest.projectId,
            projectSlug: project?.slug ?? "",
            id: props.quest.id,
          }}
          content={content}
        />
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
