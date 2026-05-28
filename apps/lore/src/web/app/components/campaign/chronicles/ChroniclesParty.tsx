import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/components/ui/chart";
import type { Static } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { UserCircle2 } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { chroniclesPartySchema } from "@/api/schemas/chroniclesSchemas.ts";
import type { I18n } from "../../../services/I18n.ts";
import ChroniclesSection from "./ChroniclesSection.tsx";

type ChroniclesParty = Static<typeof chroniclesPartySchema>;

export interface ChroniclesPartyProps {
  party: ChroniclesParty;
}

/**
 * Chronicles "Party" page — a flat dashboard of who carries the campaign:
 * an XP leaderboard, a stacked contribution area chart with one series per
 * contributor, and a roster of idle members. Receives the loader result
 * directly as `props.party`.
 */
const ChroniclesParty = (props: ChroniclesPartyProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const { leaderboard, contributors, contribution, idle } = props.party;

  // Contributor series are dynamic, so derive a stable CSS-safe id (`c0`,
  // `c1`, …) per contributor. Raw names may contain spaces/punctuation that
  // break the `--color-<key>` CSS variable `ChartContainer` generates, so we
  // never key the ChartConfig or recharts `dataKey` by the raw name.
  const series = contributors.map((name, i) => ({
    key: `c${i}`,
    name,
    color: `var(--chart-${(i % 5) + 1})`,
  }));

  const contribConfig = Object.fromEntries(
    series.map((s) => [s.key, { label: s.name, color: s.color }]),
  ) satisfies ChartConfig;

  const contribData = contribution.map((point) => {
    const row: Record<string, string | number> = { date: point.date };
    for (const s of series) {
      row[s.key] = point.counts[s.name] ?? 0;
    }
    return row;
  });

  const hasContribution = contributors.length > 0 && contribution.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <ChroniclesSection
        title={String(tr("chronicles.party.leaderboard.title"))}
      >
        {leaderboard.length > 0 ? (
          <div className="divide-y divide-border">
            {leaderboard.map((member, index) => (
              <div
                key={member.userId}
                className={`flex items-center gap-3 py-2 text-sm ${
                  index === 0 ? "font-medium" : ""
                }`}
              >
                <span className="text-muted-foreground w-5 shrink-0 tabular-nums">
                  {index + 1}
                </span>
                {member.picture ? (
                  <img
                    alt={member.name}
                    src={`/api/files/${member.picture}`}
                    className="size-8 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <UserCircle2 className="text-muted-foreground size-8 shrink-0" />
                )}
                <span className="truncate">{member.name}</span>
                <span className="ml-auto shrink-0 text-right tabular-nums">
                  <span className="font-semibold">
                    {member.questsCompleted}
                  </span>{" "}
                  <span className="text-muted-foreground text-xs">
                    {tr("chronicles.party.label.quests")}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="font-semibold">{member.xp}</span>{" "}
                  <span className="text-muted-foreground text-xs">
                    {tr("chronicles.party.label.xp")}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="font-semibold">{member.gold}</span>{" "}
                  <span className="text-muted-foreground text-xs">
                    {tr("chronicles.party.label.gold")}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {tr("chronicles.party.leaderboard.empty")}
          </p>
        )}
      </ChroniclesSection>

      <ChroniclesSection
        title={String(tr("chronicles.party.contribution.title"))}
      >
        {hasContribution ? (
          <ChartContainer
            config={contribConfig}
            className="aspect-auto h-[240px] w-full"
          >
            <AreaChart data={contribData}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stackId="a"
                  stroke={`var(--color-${s.key})`}
                  fill={`var(--color-${s.key})`}
                  fillOpacity={0.4}
                />
              ))}
            </AreaChart>
          </ChartContainer>
        ) : (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {tr("chronicles.party.contribution.empty")}
          </p>
        )}
      </ChroniclesSection>

      <ChroniclesSection title={String(tr("chronicles.party.idle.title"))}>
        {idle.length > 0 ? (
          <div className="divide-y divide-border">
            {idle.map((member) => (
              <div
                key={member.userId}
                className="flex items-center gap-3 py-2 text-sm"
              >
                {member.picture ? (
                  <img
                    alt={member.name}
                    src={`/api/files/${member.picture}`}
                    className="size-8 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <UserCircle2 className="text-muted-foreground size-8 shrink-0" />
                )}
                <span className="truncate">{member.name}</span>
                <span className="text-muted-foreground ml-auto shrink-0">
                  {member.lastCompletedAt
                    ? tr("chronicles.party.idle.lastCompleted", {
                        args: [dt.of(member.lastCompletedAt).fromNow()],
                      })
                    : tr("chronicles.party.idle.never")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {tr("chronicles.party.idle.empty")}
          </p>
        )}
      </ChroniclesSection>
    </div>
  );
};

export default ChroniclesParty;
