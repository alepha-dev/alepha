import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { MAX_QUEST_OBJECTIVES } from "@/api/schemas/questObjectivesLimit.ts";

export interface Objective {
  title: string;
  completed: boolean;
}

export interface QuestCreateObjectivesProps {
  value?: Objective[];
  onChange: (value: Objective[]) => void;
}

const QuestCreateObjectives = (props: QuestCreateObjectivesProps) => {
  const [objectives, setObjectives] = useState<Objective[]>(props.value ?? []);
  const [newObjective, setNewObjective] = useState<string>("");

  // Reached the cap the server enforces. The row goes away rather than
  // greying out: an input you cannot submit invites typing into it, and the
  // answer here is not "try again" but "this is a different quest".
  const full = objectives.length >= MAX_QUEST_OBJECTIVES;

  const addObjective = () => {
    if (!newObjective.trim() || full) return;
    const list = [
      ...objectives,
      { title: newObjective.trim(), completed: false },
    ];
    setObjectives(list);
    setNewObjective("");
    props.onChange(list);
  };

  const removeObjective = (index: number) => {
    const list = objectives.filter((_, i) => i !== index);
    setObjectives(list);
    props.onChange(list);
  };

  const updateObjective = (index: number, title: string) => {
    const updated = [...objectives];
    updated[index] = { ...updated[index], title };
    setObjectives(updated);
    props.onChange(updated);
  };

  return (
    <div className="flex w-full flex-col gap-1.5">
      {objectives.map((objective, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={objective.title}
            onChange={(e) => updateObjective(index, e.target.value)}
            placeholder="Objective description"
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-500 hover:text-red-600"
            onClick={() => removeObjective(index)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}

      {full ? (
        <p className="text-muted-foreground text-xs">
          {`A quest carries at most ${MAX_QUEST_OBJECTIVES} objectives. Past that the work is not one quest.`}
        </p>
      ) : (
        <div className="flex items-center gap-2">
          {/* `relative` wrapper + absolutely-positioned glyph + `pl-9`: the
              shape `<Control>` gives every text input, restated here because
              this row is hand-built rather than rendered by the control. */}
          <div className="relative flex-1">
            <ListChecks className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={newObjective}
              onChange={(e) => setNewObjective(e.target.value)}
              placeholder="Add new objective..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addObjective();
                }
              }}
              className="w-full pl-9"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addObjective}
            disabled={!newObjective.trim()}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default QuestCreateObjectives;
