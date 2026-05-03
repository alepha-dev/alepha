import { Card } from "@alepha/ui/components/ui/card";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { BookOpen, Coins, Sparkles } from "lucide-react";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentChaptersAtom } from "../../atoms/currentChaptersAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { currentProjectCharacterAtom } from "../../atoms/currentProjectCharacterAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import QuestLog from "./QuestLog.tsx";

const ProjectDashboard = () => {
  const [project] = useStore(currentProjectAtom);
  const [character] = useStore(currentProjectCharacterAtom);
  const [chapters = []] = useStore(currentChaptersAtom);
  const info = useInject(CharacterInfo);
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();

  if (!project) return null;

  const level = character ? info.getLevelByXp(character.xp) : 1;
  const gold = character ? info.getGold(character.balance) : 0;
  const silver = character ? info.getSilver(character.balance) : 0;
  const activeChapter = chapters
    .filter((c) => !c.closedAt)
    .sort((a, b) => b.number - a.number)[0];

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="flex flex-col gap-1 rounded-md p-3 shadow">
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Sparkles className="size-3.5" />
            {tr("dashboard.character")}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold">Lv. {level}</span>
            {character && (
              <span className="text-muted-foreground text-xs">
                {character.xp} XP
              </span>
            )}
          </div>
        </Card>

        <Card className="flex flex-col gap-1 rounded-md p-3 shadow">
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Coins className="size-3.5" />
            {tr("dashboard.purse")}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold text-amber-500">
              {gold}g
            </span>
            <span className="text-muted-foreground text-sm">{silver}s</span>
          </div>
        </Card>

        <Card
          className={`flex flex-col gap-1 rounded-md p-3 shadow ${activeChapter ? "cursor-pointer hover:border-primary/50" : ""}`}
          onClick={() => {
            if (activeChapter) {
              router.push("projectChapters", {
                params: { projectId: String(project.id) },
              });
            }
          }}
        >
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <BookOpen className="size-3.5" />
            {tr("dashboard.chapter")}
          </div>
          {activeChapter ? (
            <div className="flex flex-col">
              <span className="text-sm font-semibold">
                #{activeChapter.number} — {activeChapter.title}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">
              {tr("dashboard.chapter.none")}
            </span>
          )}
        </Card>
      </div>

      <div className="flex min-h-0 flex-1">
        <QuestLog />
      </div>
    </div>
  );
};

export default ProjectDashboard;
