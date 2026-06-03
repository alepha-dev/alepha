import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { Separator } from "@alepha/ui/components/ui/separator";
import { t } from "alepha";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  ChevronDown,
  FileText,
  ListChecks,
  Plus,
  Save,
  Signature,
  Tag,
  Tags as TagsIcon,
  Tent,
} from "lucide-react";
import { useRef } from "react";
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
import QuestTagInput from "./QuestTagInput.tsx";

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
  const acceptAfterCreate = useRef(false);

  const form = useForm({
    id: "quest-create",
    schema: t.omit(questCreateSchema, ["campaignId"]),
    initialValues: {
      ...(props.quest as QuestResource),
      priority: props.quest?.priority ?? "optional",
      difficulty: props.quest?.difficulty ?? 1,
    },
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

      let quest = await questApi.createQuest({
        body: { ...data, campaignId: props.campaign.id },
      });

      if (acceptAfterCreate.current) {
        quest = await questApi.acceptQuest({ params: { id: quest.id } });
      }
      acceptAfterCreate.current = false;

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
            shortId: String(quest.shortId),
          },
        });
      }
    },
  });

  const { loading: submitting } = useFormState(form, ["loading"]);

  const zones = currentCampaign?.zones || kanbanCampaign?.campaign?.zones || [];

  return (
    <form {...form.props} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
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
            combobox
            createNewEntry
            items={zones}
          />
        </div>

        <Control
          label={tr("quest.create.description")}
          description={tr("quest.create.description.helper")}
          input={form.input.description}
          icon={FileText}
          custom={TextEditor as never}
        />

        <Separator />

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
          label={tr("quest.create.tags")}
          description={tr("quest.create.tags.helper")}
          input={form.input.tags}
          icon={TagsIcon}
          custom={
            ((p: { value?: string[]; onChange?: (v: string[]) => void }) => (
              <QuestTagInput
                value={p.value}
                onChange={p.onChange}
                campaignId={props.campaign.id}
              />
            )) as never
          }
        />

        <Control
          label={tr("quest.create.objectives")}
          description={tr("quest.create.objectives.helper")}
          input={form.input.objectives}
          icon={ListChecks}
          custom={QuestCreateObjectives as never}
        />
      </div>

      <div className="bg-background flex shrink-0 justify-end gap-2 border-t p-4">
        {update ? (
          <Button type="submit" disabled={submitting}>
            <Save className="size-4" />
            {tr("quest.create.update")}
          </Button>
        ) : (
          <div className="flex items-stretch">
            <Button
              type="submit"
              disabled={submitting}
              className="rounded-r-none"
            >
              <Plus className="size-4" />
              {tr("quest.create.submit")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    disabled={submitting}
                    aria-label={tr("quest.create.submitAndAccept")}
                    className="border-primary-foreground/20 -ml-px rounded-l-none border-l px-2"
                  />
                }
              >
                <ChevronDown className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    acceptAfterCreate.current = true;
                    void form.submit();
                  }}
                >
                  <Signature className="size-4" />
                  {tr("quest.create.submitAndAccept")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </form>
  );
};

export default QuestCreate;
