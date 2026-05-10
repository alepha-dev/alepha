import { Control } from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { t } from "alepha";
import { useClient, useInject, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Loader2 } from "lucide-react";
import type { BeaconController } from "@/api/controllers/BeaconController.ts";
import type { BeaconResource } from "@/api/schemas/beaconResourceSchema.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { Toaster } from "../../../services/Toaster.ts";

export interface CampaignBeaconPromoteFormProps {
  beacon: BeaconResource;
  onCancel: () => void;
  onPromoted: () => void;
}

const promoteSchema = t.object({
  title: t.string({ minLength: 1, maxLength: 200, title: "Title" }),
  description: t.string({
    minLength: 1,
    maxLength: 10_000,
    title: "Description",
  }),
  zone: t.string({ minLength: 1, title: "Zone" }),
  priority: t.enum(["optional", "low", "medium", "high"], {
    mode: "text",
    default: "medium",
    title: "Priority",
  }),
  difficulty: t.integer({
    minimum: 1,
    maximum: 5,
    default: 2,
    title: "Difficulty",
  }),
});

const buildInitialDescription = (beacon: BeaconResource): string => {
  const footerBits: string[] = [
    `*Reported via Beacon #${beacon.id} from ${beacon.context.url}`,
  ];
  if (beacon.reporterEmail) {
    footerBits.push(`by ${beacon.reporterEmail}`);
  }
  const footer = `${footerBits.join(" ")}*`;
  return `${beacon.description}\n\n${footer}`;
};

const CampaignBeaconPromoteForm = (props: CampaignBeaconPromoteFormProps) => {
  const { beacon } = props;
  const { tr } = useI18n<I18n, "en">();
  const [campaign] = useStore(currentCampaignAtom);
  const beaconApi = useClient<BeaconController>();
  const toaster = useInject(Toaster);

  const zones = campaign?.zones ?? [];

  const form = useForm({
    id: `beacon-promote-${beacon.id}`,
    schema: promoteSchema,
    initialValues: {
      title: beacon.title,
      description: buildInitialDescription(beacon),
      zone: zones[0] ?? "",
      priority: "medium" as const,
      difficulty: 2,
    },
    handler: async (data) => {
      if (!campaign) return;
      try {
        await beaconApi.promote({
          params: { campaignId: campaign.id, beaconId: beacon.id },
          body: {
            title: data.title,
            description: data.description,
            zone: data.zone,
            priority: data.priority,
            difficulty: data.difficulty,
          },
        });
        props.onPromoted();
      } catch (err: any) {
        toaster.show(
          err?.message ?? String(tr("beacons.promoteError")),
          "danger",
        );
      }
    },
  });

  return (
    <form
      {...form.props}
      className="border-border bg-muted/20 flex flex-col gap-3 rounded border p-3"
    >
      <h3 className="text-sm font-medium">{tr("beacons.promoteForm.title")}</h3>

      <Control
        label={String(tr("beacons.promoteForm.questTitle"))}
        input={form.input.title}
        text
      />

      <Control
        label={String(tr("beacons.promoteForm.description"))}
        input={form.input.description}
        area
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Control
          label={String(tr("beacons.promoteForm.zone"))}
          input={form.input.zone}
          custom={({ value, onChange }) => (
            <Select
              value={value != null ? String(value) : ""}
              onValueChange={(v) => onChange(v)}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={String(
                    tr("beacons.promoteForm.zonePlaceholder"),
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {zones.length === 0 ? (
                  <div className="text-muted-foreground p-2 text-xs">
                    {tr("beacons.promoteForm.noZones")}
                  </div>
                ) : (
                  zones.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          )}
        />

        <Control
          label={String(tr("beacons.promoteForm.priority"))}
          input={form.input.priority}
          custom={({ value, onChange }) => (
            <Segmented
              value={value != null ? String(value) : "medium"}
              onChange={(v) => onChange(v)}
              options={[
                {
                  value: "optional",
                  label: String(tr("beacons.promoteForm.priorityOptional")),
                },
                {
                  value: "low",
                  label: String(tr("beacons.promoteForm.priorityLow")),
                },
                {
                  value: "medium",
                  label: String(tr("beacons.promoteForm.priorityMedium")),
                },
                {
                  value: "high",
                  label: String(tr("beacons.promoteForm.priorityHigh")),
                },
              ]}
              fullWidth
              size="sm"
            />
          )}
        />
      </div>

      <Control
        label={String(tr("beacons.promoteForm.difficulty"))}
        input={form.input.difficulty}
        custom={({ value, onChange }) => (
          <Segmented
            value={value != null ? String(value) : "2"}
            onChange={(v) => onChange(Number(v))}
            options={[
              { value: "1", label: "F" },
              { value: "2", label: "C" },
              { value: "3", label: "B" },
              { value: "4", label: "A" },
              { value: "5", label: "S" },
            ]}
            fullWidth
            size="sm"
          />
        )}
      />

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          onClick={props.onCancel}
          disabled={form.submitting}
        >
          {tr("beacons.promoteForm.cancel")}
        </Button>
        <Button type="submit" disabled={form.submitting}>
          {form.submitting && <Loader2 className="size-4 animate-spin" />}
          {tr("beacons.promoteForm.submit")}
        </Button>
      </div>
    </form>
  );
};

export default CampaignBeaconPromoteForm;
