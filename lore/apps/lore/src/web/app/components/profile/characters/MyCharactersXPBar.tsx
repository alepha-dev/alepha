import { useI18n } from "alepha/react/i18n";
import type { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import type { MyCharactersCharacter } from "./MyCharacters.tsx";

export interface MyCharactersXPBarProps {
  character: MyCharactersCharacter;
  characterInfo: CharacterInfo;
}

const MyCharactersXPBar = (props: MyCharactersXPBarProps) => {
  const { character, characterInfo } = props;
  const level = characterInfo.getLevelByXp(character.xp);
  const maxXp = characterInfo.getMaxXpForLevel(level);
  const currentXp = characterInfo.getCurrentXpForLevel(level, character.xp);
  const percentage = Math.floor((currentXp * 100) / maxXp);
  const { l } = useI18n();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Experience Progress
        </span>
        <span className="text-xs text-muted-foreground">
          {l(currentXp)} / {l(maxXp)} XP
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-sm bg-muted">
        <div
          className="h-full rounded-sm bg-blue-500 transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">
        Level {level} • {percentage}% to Level {level + 1}
      </span>
    </div>
  );
};

export default MyCharactersXPBar;
