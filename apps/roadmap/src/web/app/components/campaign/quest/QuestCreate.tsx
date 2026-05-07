import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { t } from "alepha";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { FileText, ListChecks, Plus, Save, Tag, Tent } from "lucide-react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { Campaign } from "@/api/entities/campaigns.ts";
import { questCreateSchema } from "@/api/schemas/questCreateSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import { kanbanCampaignAtom } from "@/web/app/atoms/kanbanCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import TextEditor from "../../shared/TextEditor.tsx";
import QuestCreateObjectives from "./QuestCreateObjectives.tsx";

export interface QuestCreateProps {
  onSubmit: (quest: QuestResource) => void;
  onCreated?: (quest: QuestResource) => void;
  quest?: Partial<QuestResource>;
  campaign: Campaign;
}

const QuestCreate = (props: QuestCreateProps) => {
  const questApi = useClient<QuestController>();
  const alepha = useAlepha();
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const [currentCampaign, setCurrentCampaign] = useStore(currentCampaignAtom);
  const [kanbanCampaign] = useStore(kanbanCampaignAtom);

  const update = !!props.quest?.id;

  const form = useForm({
    id: "quest-create",
    schema: t.omit(questCreateSchema, ["campaignId"]),
    initialValues: props.quest as QuestResource,
    handler: async (data) => {
      if (props.quest?.id) {
        const resp = await questApi.updateQuestById({
          params: { id: props.quest.id },
          body: data,
        });
        alepha.store.set(currentAssignedQuestsAtom, [
          resp,
          ...(alepha.store.get(currentAssignedQuestsAtom) ?? []).filter(
            (quest) => quest.id !== resp.id,
          ),
        ]);
        props.onSubmit(resp);
        return;
      }

      const quest = await questApi.createQuest({
        body: { ...data, campaignId: props.campaign.id },
      });

      if (
        data.zone &&
        !props.campaign.zones?.includes(data.zone) &&
        currentCampaign
      ) {
        const updatedZones = [...(currentCampaign.zones || []), data.zone];
        setCurrentCampaign({ ...currentCampaign, zones: updatedZones });
      }

      props.onSubmit(quest);

      if (props.onCreated) {
        props.onCreated(quest);
      } else {
        await router.push("campaignQuest", {
          params: {
            campaignId: String(props.campaign.id),
            questId: String(quest.id),
          },
        });
      }
    },
  });

  const zones = currentCampaign?.zones || kanbanCampaign?.campaign?.zones || [];

  return (
    <form {...form.props} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Control
          label={tr("quest.create.title")}
          description={tr("quest.create.title.helper")}
          input={form.input.title}
          icon={Tag}
        />
        <Control
          label={tr("quest.create.zone")}
          description={tr("quest.create.zone.helper")}
          input={form.input.zone}
          icon={Tent}
          text
        />
      </div>

      <Control
        label={tr("quest.create.description")}
        description={tr("quest.create.description.helper")}
        input={form.input.description}
        icon={FileText}
        custom={TextEditor as never}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Control
          input={form.input.priority}
          label={tr("quest.create.priority")}
          description={tr("quest.create.priority.helper")}
          segmented
        />
        <Control
          input={form.input.difficulty}
          label={tr("quest.create.difficulty")}
          description={tr("quest.create.difficulty.helper")}
          custom={({ value, onChange }) => (
            <Segmented
              value={value != null ? String(value) : undefined}
              onChange={(v) => onChange(Number(v))}
              options={[
                { value: "1", label: "F" },
                { value: "2", label: "C" },
                { value: "3", label: "B" },
                { value: "4", label: "A" },
                { value: "5", label: "S" },
              ]}
              fullWidth
            />
          )}
        />
      </div>

      <Control
        label={tr("quest.create.objectives")}
        description={tr("quest.create.objectives.helper")}
        input={form.input.objectives}
        icon={ListChecks}
        custom={QuestCreateObjectives as never}
      />

      {/* zone suggestions: hint */}
      {zones.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Existing zones: {zones.join(", ")}
        </p>
      )}

      <div className="flex">
        {update ? (
          <Button type="submit" disabled={form.submitting}>
            <Save className="size-4" />
            {tr("quest.create.update")}
          </Button>
        ) : (
          <Button type="submit" disabled={form.submitting}>
            <Plus className="size-4" />
            {tr("quest.create.submit")}
          </Button>
        )}
      </div>
    </form>
  );
};

export default QuestCreate;
