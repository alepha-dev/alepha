import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import { currentProjectCharacterAtom } from "../../atoms/currentProjectCharacterAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import LevelUpAnimation from "./LevelUpAnimation.tsx";

const ExperienceBar = () => {
  const auth = useAuth();
  const { tr } = useI18n<I18n, "en">();
  const [character] = useStore(currentProjectCharacterAtom);
  const info = useInject(CharacterInfo);

  if (!auth.user || !character) {
    return null;
  }

  const level = info.getLevelByXp(character.xp);
  const max = info.getMaxXpForLevel(level);
  const current = info.getCurrentXpForLevel(level, character.xp);
  const percentage = max > 0 ? Math.floor((current * 100) / max) : 100;

  return (
    <>
      <LevelUpAnimation />
      <div className="p-2">
        <div className="relative flex h-3 w-full items-center">
          <div className="h-2.5 w-full overflow-hidden rounded-full border border-border bg-muted">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="pointer-events-auto cursor-help text-[10px] font-medium text-foreground/90 mix-blend-difference">
                  XP: {current}/{max}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <div className="flex max-w-64 flex-col">
                  <span className="font-medium">{tr("xp.bar.title")}</span>
                  <span className="text-sm">{tr("xp.bar.description")}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </>
  );
};

export default ExperienceBar;
