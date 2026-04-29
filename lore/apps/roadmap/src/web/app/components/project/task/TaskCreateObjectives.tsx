import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

export interface Objective {
  title: string;
  completed: boolean;
}

export interface TaskCreateObjectivesProps {
  value?: Objective[];
  onChange: (value: Objective[]) => void;
}

const TaskCreateObjectives = (props: TaskCreateObjectivesProps) => {
  const [objectives, setObjectives] = useState<Objective[]>(props.value ?? []);
  const [newObjective, setNewObjective] = useState<string>("");

  const addObjective = () => {
    if (!newObjective.trim()) return;
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

      <div className="flex items-center gap-2">
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
          className="flex-1"
        />
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
    </div>
  );
};

export default TaskCreateObjectives;
