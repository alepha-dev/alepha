import { useStore } from "alepha/react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import LoreViewer from "../../shared/element/LoreViewer.tsx";
import { useReadingFonts } from "../../shared/useReadingFonts.ts";

export interface QuestDescriptionProps {
  quest: QuestResource;
  onEdit: () => void;
}

const QuestDescription = (props: QuestDescriptionProps) => {
  const content = props.quest.description ?? "";
  // The quest row carries the project's integer id; the links this produces
  // need its slug, which the surrounding project layout has already loaded.
  const [project] = useStore(currentProjectAtom);
  // Literata is lazy-loaded, and only by the surfaces that set prose in it.
  // Without this the `folio-prose` class below silently falls back to
  // Iowan/Georgia and the description looks like a near-miss of the design.
  useReadingFonts();

  return (
    <div className="bg-muted border-border rounded-md border p-3 px-4">
      {content ? (
        <LoreViewer
          className="folio-prose text-[15.5px] leading-[1.7]"
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
