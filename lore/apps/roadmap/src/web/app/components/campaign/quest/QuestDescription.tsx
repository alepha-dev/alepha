import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

export interface QuestDescriptionProps {
  quest: QuestResource;
  onEdit: () => void;
}

const stripHtml = (html: string) => {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>(?!\n)/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
};

const QuestDescription = (props: QuestDescriptionProps) => {
  const text = stripHtml(props.quest.description ?? "");

  return (
    <div className="bg-muted border-border rounded-md border p-3 px-4">
      {text ? (
        <pre className="font-sans text-sm whitespace-pre-wrap break-words">
          {text}
        </pre>
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
