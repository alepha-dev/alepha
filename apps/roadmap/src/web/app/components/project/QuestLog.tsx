import { Button } from "@alepha/ui/components/ui/button";
import { Card } from "@alepha/ui/components/ui/card";
import { Input } from "@alepha/ui/components/ui/input";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { BookOpen, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { currentAssignedTasksAtom } from "../../atoms/currentAssignedTasksAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import TaskList from "./task/TaskList.tsx";

const QuestLog = () => {
  const [tasks = []] = useStore(currentAssignedTasksAtom);
  const { tr } = useI18n<I18n, "en">();
  const [searchValue, setSearchValue] = useState<string>("");

  const filteredTasks = useMemo(() => {
    if (!searchValue.trim()) {
      return tasks;
    }
    return tasks.filter((task) =>
      task.title.toLowerCase().includes(searchValue.toLowerCase().trim()),
    );
  }, [tasks, searchValue]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(event.currentTarget.value);
  };

  const handleClearSearch = () => {
    setSearchValue("");
  };

  return (
    <Card className="bg-card relative flex h-full w-full flex-1 flex-col gap-2 rounded-md p-0 shadow">
      <div className="flex gap-2 p-2">
        <div className="hidden items-center justify-center px-2 xl:flex">
          <BookOpen className="size-6" />
        </div>
        <Card className="bg-muted flex flex-1 flex-row items-center rounded-md p-0 px-2 shadow">
          <div className="flex items-center justify-center gap-2 px-1">
            <span className="text-xs">{tr("quest-log.quests")}</span>
            <Card className="rounded-md px-1.5 py-0">
              <span className="text-xs">{filteredTasks.length}/25</span>
            </Card>
          </div>
          <div className="flex-1" />
        </Card>
      </div>
      <div className="flex px-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            disabled={tasks.length === 0}
            placeholder={tr("quest-log.search")}
            value={searchValue}
            onChange={handleSearchChange}
            className="h-8 rounded-full pr-8 pl-7 text-xs"
          />
          {searchValue && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearSearch}
              className="absolute top-1/2 right-1 size-6 -translate-y-1/2"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2 overflow-auto p-2">
        <TaskList tasks={filteredTasks} />
      </div>
    </Card>
  );
};

export default QuestLog;
