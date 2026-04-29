import {
  ToggleGroup,
  ToggleGroupItem,
} from "@alepha/ui/components/ui/toggle-group";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { BookOpen, ChartLine, Settings, Table } from "lucide-react";
import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import ProjectActionsCreateButton from "./ProjectActionsCreateButton.tsx";

type TabValue =
  | "projectBoard"
  | "projectChapters"
  | "projectAnalytics"
  | "projectSettings";

const ProjectActions = () => {
  const [project] = useStore(currentProjectAtom);
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const routerState = useRouterState();

  if (!project) return null;

  const opts = {
    params: { projectId: String(project.id) },
  };

  let name = routerState.name;
  if (name === "projectBoardTable") {
    name = "projectBoard";
  }

  const tabs: Array<{ value: TabValue; icon: React.ReactNode; label: string }> =
    [
      {
        value: "projectBoard",
        icon: <Table className="size-4" />,
        label: String(tr("project.menu.board")),
      },
      {
        value: "projectChapters",
        icon: <BookOpen className="size-4" />,
        label: String(tr("project.menu.chapters")),
      },
      {
        value: "projectAnalytics",
        icon: <ChartLine className="size-4" />,
        label: String(tr("project.menu.analytics")),
      },
      {
        value: "projectSettings",
        icon: <Settings className="size-4" />,
        label: String(tr("project.menu.settings")),
      },
    ];

  return (
    <div className="bg-card border-border flex flex-1 items-center gap-2 rounded-md border p-1">
      <ToggleGroup
        type="single"
        value={name}
        onValueChange={(value) => {
          if (value) router.push(value as TabValue, opts);
        }}
        className="flex"
      >
        {tabs.map((tab) => (
          <ToggleGroupItem
            key={tab.value}
            value={tab.value}
            className="gap-1.5"
          >
            {tab.icon}
            <span className="hidden text-sm sm:inline">{tab.label}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="flex-1" />
      <ProjectActionsCreateButton />
    </div>
  );
};

export default ProjectActions;
