import { Badge } from "@alepha/ui/components/ui/badge";
import { Input } from "@alepha/ui/components/ui/input";
import { useI18n } from "alepha/react/i18n";
import { X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface MilestoneTagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/**
 * Chip-style tag input — type and press Enter to add, click X to remove.
 * Deduplicates on add. Empty input on Backspace removes the last chip.
 */
const MilestoneTagInput = (props: MilestoneTagInputProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (props.value.includes(v)) return;
    props.onChange([...props.value, v]);
    setDraft("");
  };

  const remove = (tag: string) => {
    props.onChange(props.value.filter((t) => t !== tag));
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(draft);
    } else if (
      e.key === "Backspace" &&
      draft === "" &&
      props.value.length > 0
    ) {
      e.preventDefault();
      remove(props.value[props.value.length - 1]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5">
      {props.value.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="gap-1 font-mono text-xs"
        >
          {tag}
          {!props.disabled && (
            <button
              type="button"
              onClick={() => remove(tag)}
              className="hover:bg-destructive/20 -mr-1 ml-0.5 rounded-sm p-0.5"
              aria-label={`Remove ${tag}`}
            >
              <X className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={onKey}
        onBlur={() => commit(draft)}
        placeholder={tr("milestone.tags.placeholder")}
        disabled={props.disabled}
        className="h-7 min-w-32 flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
      />
    </div>
  );
};

export default MilestoneTagInput;
