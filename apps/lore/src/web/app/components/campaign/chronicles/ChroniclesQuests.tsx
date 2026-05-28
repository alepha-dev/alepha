import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/components/ui/chart";
import type { Static } from "alepha";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { chroniclesQuestsSchema } from "@/api/schemas/chroniclesSchemas.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import ChroniclesSection from "./ChroniclesSection.tsx";

type ChroniclesQuests = Static<typeof chroniclesQuestsSchema>;

export interface ChroniclesQuestsProps {
  quests: ChroniclesQuests;
}

/**
 * Chronicles "Quests" page — a flat dashboard of quest flow: a status funnel,
 * completed-vs-remaining breakdowns by zone and priority, cycle time, and an
 * actionable list of the oldest open quests. Receives the loader result
 * directly as `props.quests`.
 */
const ChroniclesQuests = (props: ChroniclesQuestsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const { funnel, byZone, byPriority, cycleTimeByPriority, aging } =
    props.quests;

  // Stacked completed/remaining series — shared by the by-zone and by-priority
  // charts. `ChartContainer` exposes each key as a `--color-<key>` CSS
  // variable. Built in-body so labels can be translated via `tr`.
  const breakdownChartConfig = {
    completed: {
      label: String(tr("chronicles.quests.completed")),
      color: "var(--chart-1)",
    },
    remaining: {
      label: String(tr("chronicles.quests.remaining")),
      color: "var(--muted-foreground)",
    },
  } satisfies ChartConfig;

  const cycleTimeChartConfig = {
    avgHours: {
      label: String(tr("chronicles.quests.cycleTime.avgHours")),
      color: "var(--chart-4)",
    },
  } satisfies ChartConfig;

  const funnelTotal = funnel.new + funnel.accepted + funnel.completed;
  const funnelItems = [
    {
      key: "new",
      value: funnel.new,
      label: String(tr("chronicles.quests.status.new")),
      segment: "bg-muted-foreground/40",
    },
    {
      key: "accepted",
      value: funnel.accepted,
      label: String(tr("chronicles.quests.status.accepted")),
      segment: "bg-[var(--chart-4)]",
    },
    {
      key: "completed",
      value: funnel.completed,
      label: String(tr("chronicles.quests.status.completed")),
      segment: "bg-[var(--chart-1)]",
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <ChroniclesSection title={String(tr("chronicles.quests.status.title"))}>
        {funnelTotal > 0 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              {funnelItems.map((item) => (
                <div key={item.key} className="flex flex-col">
                  <span className="text-2xl font-semibold tabular-nums">
                    {item.value}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-full">
              {funnelItems.map((item) => (
                <div
                  key={item.key}
                  className={item.segment}
                  style={{
                    width: `${(item.value / funnelTotal) * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {tr("chronicles.quests.status.empty")}
          </p>
        )}
      </ChroniclesSection>

      <ChroniclesSection title={String(tr("chronicles.quests.byZone.title"))}>
        {byZone.length > 0 ? (
          <ChartContainer
            config={breakdownChartConfig}
            className="aspect-auto h-[240px] w-full"
          >
            <BarChart data={byZone}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="zone"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="completed"
                stackId="a"
                fill="var(--color-completed)"
              />
              <Bar
                dataKey="remaining"
                stackId="a"
                fill="var(--color-remaining)"
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {tr("chronicles.quests.empty")}
          </p>
        )}
      </ChroniclesSection>

      <ChroniclesSection
        title={String(tr("chronicles.quests.byPriority.title"))}
      >
        {byPriority.length > 0 ? (
          <ChartContainer
            config={breakdownChartConfig}
            className="aspect-auto h-[220px] w-full"
          >
            <BarChart data={byPriority}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="priority"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="completed"
                stackId="a"
                fill="var(--color-completed)"
              />
              <Bar
                dataKey="remaining"
                stackId="a"
                fill="var(--color-remaining)"
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {tr("chronicles.quests.empty")}
          </p>
        )}
      </ChroniclesSection>

      <ChroniclesSection
        title={String(tr("chronicles.quests.cycleTime.title"))}
      >
        {cycleTimeByPriority.length > 0 ? (
          <ChartContainer
            config={cycleTimeChartConfig}
            className="aspect-auto h-[200px] w-full"
          >
            <BarChart data={cycleTimeByPriority}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="priority"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="avgHours" fill="var(--color-avgHours)" radius={4} />
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {tr("chronicles.quests.empty")}
          </p>
        )}
      </ChroniclesSection>

      <ChroniclesSection title={String(tr("chronicles.quests.aging.title"))}>
        {aging.length > 0 ? (
          <div className="divide-y divide-border">
            {aging.map((quest) => (
              <Link
                key={quest.shortId}
                href={router.path("campaignQuest", {
                  params: { shortId: quest.shortId },
                })}
                className="hover:bg-muted/50 flex items-center gap-3 py-2 text-sm"
              >
                <span className="text-muted-foreground tabular-nums">
                  #{quest.shortId}
                </span>
                <span className="truncate font-medium">{quest.title}</span>
                <span className="text-muted-foreground shrink-0">
                  {quest.zone}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {quest.priority}
                </span>
                <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                  {quest.ageDays}d
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {tr("chronicles.quests.aging.empty")}
          </p>
        )}
      </ChroniclesSection>
    </div>
  );
};

export default ChroniclesQuests;
