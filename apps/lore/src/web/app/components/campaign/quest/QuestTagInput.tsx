import { Badge } from "@alepha/ui/components/ui/badge";
import { Input } from "@alepha/ui/components/ui/input";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { X } from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface QuestTagInputProps {
  value?: string[];
  onChange?: (next: string[]) => void;
  disabled?: boolean;
  /** Campaign id used to fetch the known-tags suggestion list. */
  campaignId?: number;
}

/**
 * Chip-style tag input with campaign-level autocomplete. Type and press
 * Enter to commit; click X to remove; suggestions show only the unused
 * tags so the same campaign converges on a stable taxonomy.
 *
 * Normalization here mirrors the server's `normalizeQuestTags`: trim +
 * lowercase. We dedupe on commit too so a sloppy paste doesn't sneak
 * duplicates past the server round-trip.
 */
const QuestTagInput = (props: QuestTagInputProps) => {
  const { tr } = useI18n<I18n, "en">();
  const questApi = useClient<QuestController>();
  const [draft, setDraft] = useState("");
  const [known, setKnown] = useState<string[]>([]);

  const value = props.value ?? [];

  useEffect(() => {
    if (!props.campaignId) return;
    let alive = true;
    questApi
      .listQuestTags({ query: { campaignId: props.campaignId } })
      .then((tags) => {
        if (alive) setKnown(tags);
      })
      .catch(() => {
        // suggestions are a nice-to-have; absorbing the failure keeps
        // the input usable for offline / first-tag scenarios.
      });
    return () => {
      alive = false;
    };
  }, [props.campaignId]);

  const commit = (raw: string) => {
    const v = raw.trim().toLowerCase();
    if (!v || value.includes(v)) {
      setDraft("");
      return;
    }
    props.onChange?.([...value, v]);
    setDraft("");
  };

  const remove = (tag: string) => {
    props.onChange?.(value.filter((t) => t !== tag));
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      e.preventDefault();
      remove(value[value.length - 1]);
    }
  };

  const suggestions = known.filter(
    (t) =>
      !value.includes(t) &&
      (draft === "" || t.startsWith(draft.trim().toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5">
        {value.map((tag) => (
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
          placeholder={tr("quest.tags.placeholder")}
          disabled={props.disabled}
          className="h-7 min-w-32 flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">
            {tr("quest.tags.suggestions")}
          </span>
          {suggestions.slice(0, 12).map((tag) => (
            <button
              key={tag}
              type="button"
              disabled={props.disabled}
              onClick={() => commit(tag)}
              className="bg-muted hover:bg-muted/70 rounded-sm border px-1.5 py-0.5 font-mono text-xs"
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default QuestTagInput;
