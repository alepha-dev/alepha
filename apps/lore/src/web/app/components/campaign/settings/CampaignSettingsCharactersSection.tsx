import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { Localize, useI18n } from "alepha/react/i18n";
import { Circle, Mail, Plus, Users } from "lucide-react";
import { useState } from "react";
import type { InvitationController } from "@/api/controllers/InvitationController.ts";
import type { Campaign } from "@/api/entities/campaigns.ts";
import type { Character } from "@/api/entities/characters.ts";
import type { InvitationEntity } from "@/api/entities/invitations.ts";
import type { User } from "@/api/entities/users.ts";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import { CharacterIdentity } from "@/web/app/components/shared/CharacterIdentity.tsx";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface CampaignSettingsCharactersSectionProps {
  campaign: Campaign;
  characters: Array<Character & { user: User }>;
  pendingInvitations: Array<InvitationEntity>;
}

const CampaignSettingsCharactersSection = (
  props: CampaignSettingsCharactersSectionProps,
) => {
  const characterInfo = useInject(CharacterInfo);
  const toaster = useToast();
  const invitationApi = useClient<InvitationController>();
  const auth = useAuth();
  const { l } = useI18n();
  const { tr } = useI18n<I18n, "en">();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const characters = props.characters;
  const pendingInvitations = props.pendingInvitations ?? [];

  const handleInvite = async () => {
    if (!email.trim()) {
      toaster.error("Please enter an email address");
      return;
    }
    setLoading(true);
    try {
      await invitationApi.createInvitation({
        body: {
          email: email.trim(),
          resourceType: "campaign",
          resourceId: String(props.campaign.id),
        },
      });
      toaster.success(`Invitation sent to ${email}`);
      setEmail("");
      setOpen(false);
      window.location.reload();
    } catch (error: any) {
      toaster.error(error.message || "Failed to send invitation");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tr("campaign.settings.characters.invite.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              {tr("campaign.settings.characters.invite.description", {
                args: [props.campaign.title],
              })}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label>{tr("campaign.settings.characters.invite.email")}</Label>
              <div className="relative">
                <Mail className="text-muted-foreground absolute top-1/2 left-2 size-4 -translate-y-1/2" />
                <Input
                  className="pl-8"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleInvite();
                  }}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tr("campaign.settings.characters.invite.cancel")}
            </Button>
            <Button onClick={handleInvite} disabled={loading}>
              {tr("campaign.settings.characters.invite.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {tr("campaign.settings.characters.title")}
            </span>
            <Badge variant="secondary">
              {characters.length + pendingInvitations.length}
            </Badge>
          </div>
          {props.campaign.createdBy === auth.user?.id && (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-3.5" />
              {tr("campaign.settings.characters.invite.action")}
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {characters.map((character) => {
            const level = characterInfo.getLevelByXp(character.xp);
            const gold = characterInfo.getGold(character.balance);
            const silver = characterInfo.getSilver(character.balance);

            return (
              <Card key={character.id} className="py-3 shadow">
                <CardContent className="flex items-center gap-4 px-3">
                  <div className="flex flex-1 items-center gap-3">
                    <CharacterIdentity character={character} variant="card" />
                    <span className="text-muted-foreground text-xs">
                      {character.user.email}
                    </span>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                      <span className="text-muted-foreground text-xs">
                        Lv. {level}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {l(character.xp)} XP
                      </span>
                    </div>
                    <div className="flex gap-1">
                      {gold > 0 && (
                        <div className="flex items-center gap-0.5">
                          <span className="text-xs font-medium">{gold}</span>
                          <Circle
                            className="size-2 fill-current"
                            style={{ color: "var(--color-gold)" }}
                          />
                        </div>
                      )}
                      {silver > 0 && (
                        <div className="flex items-center gap-0.5">
                          <span className="text-xs font-medium">{silver}</span>
                          <Circle
                            className="size-2 fill-current"
                            style={{ color: "var(--color-silver)" }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <span className="text-muted-foreground text-xs">
                    <Localize value={character.createdAt} date="fromNow" />
                  </span>
                </CardContent>
              </Card>
            );
          })}

          {pendingInvitations.map((invitation) => (
            <Card key={invitation.id} className="py-3 shadow opacity-80">
              <CardContent className="flex items-center gap-4 px-3">
                <div className="bg-muted flex size-10 items-center justify-center rounded-md">
                  <Mail className="size-5" />
                </div>
                <div className="flex flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {invitation.email}
                    </span>
                    <Badge variant="secondary">Pending</Badge>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    <Localize value={invitation.createdAt} date="fromNow" />
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}

          {characters.length === 0 && pendingInvitations.length === 0 && (
            <Card className="shadow">
              <CardContent className="flex flex-col items-center justify-center gap-2">
                <Users className="size-8 opacity-50" />
                <span className="text-muted-foreground text-center text-sm">
                  {tr("campaign.settings.characters.empty")}
                </span>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
};

export default CampaignSettingsCharactersSection;
