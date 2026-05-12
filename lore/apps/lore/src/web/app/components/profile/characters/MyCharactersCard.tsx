import { Badge } from "@alepha/ui/components/ui/badge";
import { Localize, useI18n } from "alepha/react/i18n";
import { Circle, Crown } from "lucide-react";
import type { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import type { MyCharactersCharacter } from "./MyCharacters.tsx";
import MyCharactersXPBar from "./MyCharactersXPBar.tsx";

export interface MyCharactersCardProps {
  character: MyCharactersCharacter;
  characterInfo: CharacterInfo;
}

const MyCharactersCard = (props: MyCharactersCardProps) => {
  const { character, characterInfo } = props;
  const { l } = useI18n();
  const level = characterInfo.getLevelByXp(character.xp);
  const gold = characterInfo.getGold(character.balance);
  const silver = characterInfo.getSilver(character.balance);

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-medium">
              {character.campaignTitle}
            </span>
            {character.owner && (
              <Badge variant="secondary" className="gap-1">
                <Crown className="size-3" />
                Owner
              </Badge>
            )}
          </div>
          <span className="text-sm text-muted-foreground">
            Created <Localize value={character.createdAt} date="fromNow" />
          </span>
        </div>

        <div className="flex gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">
              Level
            </span>
            <span className="text-sm font-medium">{level}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">
              Balance
            </span>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-sm font-medium">
                {gold}
                <Circle
                  className="size-3"
                  fill="var(--color-gold)"
                  color="var(--color-gold)"
                />
              </span>
              {silver > 0 && (
                <span className="flex items-center gap-1 text-sm font-medium">
                  {silver}
                  <Circle
                    className="size-3"
                    fill="var(--color-silver)"
                    color="var(--color-silver)"
                  />
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">
              Total XP
            </span>
            <span className="text-sm font-medium">{l(character.xp)}</span>
          </div>
        </div>
      </div>

      <MyCharactersXPBar character={character} characterInfo={characterInfo} />
    </div>
  );
};

export default MyCharactersCard;
