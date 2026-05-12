import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Circle, Wallet } from "lucide-react";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import { currentCampaignCharacterAtom } from "@/web/app/atoms/currentCampaignCharacterAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export type CampaignSettingsCharacterSectionProps = {};

const CampaignSettingsCharacterSection = (
  props: CampaignSettingsCharacterSectionProps,
) => {
  const [character] = useStore(currentCampaignCharacterAtom);
  const helper = useInject(CharacterInfo);
  const { tr } = useI18n<I18n, "en">();
  const i18n = useI18n();

  if (!character) {
    return null;
  }

  const gold = helper.getGold(character.balance);
  const silver = helper.getSilver(character.balance);
  const level = helper.getLevelByXp(character.xp);
  const nextXp = helper.getNextXpForLevel(character.xp);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm">{tr("campaign.settings.character.title")}</span>
      <Card className="bg-card shadow">
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex flex-1 flex-col items-center justify-center">
            <span className="text-sm">
              {tr("campaign.settings.character.level", {
                args: [String(level)],
              })}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr("campaign.settings.character.nextLevel", {
                args: [String(i18n.l(nextXp))],
              })}
            </span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="flex items-center gap-2">
              <Wallet className="size-4" />
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5">
                  <span className="text-sm">{gold}</span>
                  <Circle
                    className="size-2 fill-current"
                    style={{ color: "var(--color-gold)" }}
                  />
                </div>
                <div className="flex items-center gap-0.5">
                  <span className="text-sm">{silver}</span>
                  <Circle
                    className="size-2 fill-current"
                    style={{ color: "var(--color-silver)" }}
                  />
                </div>
              </div>
            </div>
            <span className="text-muted-foreground text-xs">
              {tr("campaign.settings.character.balance")}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CampaignSettingsCharacterSection;
