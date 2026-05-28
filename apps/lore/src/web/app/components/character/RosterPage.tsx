import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useState } from "react";
import type { CampaignController } from "@/api/controllers/CampaignController.ts";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import {
  CharacterIdentity,
  type CharacterWithUser,
} from "@/web/app/components/shared/CharacterIdentity.tsx";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../services/I18n.ts";

type SortMode = "level" | "joined";

const RosterPage = () => {
  const [campaign] = useStore(currentCampaignAtom);
  const campaignApi = useClient<CampaignController>();
  const characterInfo = useInject(CharacterInfo);
  const { tr } = useI18n<I18n, "en">();

  const [characters, setCharacters] = useState<CharacterWithUser[] | null>(
    null,
  );
  const [sort, setSort] = useState<SortMode>("level");

  // biome-ignore lint/correctness/useExhaustiveDependencies: campaign id is the only relevant dep
  useEffect(() => {
    if (!campaign) return;
    campaignApi
      .getCampaignCharacters({ params: { id: campaign.id } })
      .then((rows) => setCharacters(rows as CharacterWithUser[]))
      .catch(() => setCharacters([]));
  }, [campaign?.id]);

  if (!campaign) return null;

  const sorted = (characters ?? []).slice().sort((a, b) => {
    if (sort === "joined") {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    return characterInfo.getLevelByXp(b.xp) - characterInfo.getLevelByXp(a.xp);
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {tr("character.roster.title", {
            args: [String(characters?.length ?? 0)],
          })}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={sort === "level" ? "default" : "outline"}
            onClick={() => setSort("level")}
          >
            {tr("character.roster.sort.level")}
          </Button>
          <Button
            size="sm"
            variant={sort === "joined" ? "default" : "outline"}
            onClick={() => setSort("joined")}
          >
            {tr("character.roster.sort.joined")}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {sorted.map((character) => (
          <Card key={character.id} className="py-3 shadow">
            <CardContent className="flex items-center gap-4 px-3">
              <CharacterIdentity character={character} variant="card" />
            </CardContent>
          </Card>
        ))}
        {characters !== null && characters.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {tr("character.roster.empty")}
          </p>
        )}
      </div>
    </div>
  );
};

export default RosterPage;
