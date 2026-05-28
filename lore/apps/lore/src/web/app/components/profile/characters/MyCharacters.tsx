import { Badge } from "@alepha/ui/components/ui/badge";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Swords } from "lucide-react";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import MyCharactersCard from "./MyCharactersCard.tsx";

export interface MyCharactersCharacter {
  id: number;
  campaignId: number;
  campaignTitle: string;
  xp: number;
  balance: number;
  owner?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MyCharactersProps {
  characters: Array<MyCharactersCharacter>;
}

const MyCharacters = (props: MyCharactersProps) => {
  const { characters } = props;
  const characterInfo = useInject(CharacterInfo);
  // ensure i18n imported at site of usage in cards
  useI18n();

  if (!characters || characters.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8">
        <Swords className="size-10 opacity-30" />
        <span className="text-center text-muted-foreground">
          No characters yet. Join a campaign to begin your adventure.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <div className="flex items-center gap-2">
        <Swords className="size-5" />
        <span className="text-lg font-bold">My Characters</span>
        <Badge variant="secondary">{characters.length}</Badge>
      </div>
      <div className="flex flex-col gap-3">
        {characters.map((character) => (
          <MyCharactersCard
            key={character.id}
            character={character}
            characterInfo={characterInfo}
          />
        ))}
      </div>
    </div>
  );
};

export default MyCharacters;
