import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@alepha/ui/components/ui/chart";
import type { Infer } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { reportsMembersSchema } from "@/api/schemas/reportsSchemas.ts";
import type { I18n } from "../../../services/I18n.ts";
import { UserAvatar } from "../../shared/UserAvatar.tsx";
import ReportsSection from "./ReportsSection.tsx";

type ReportsMembers = Infer<typeof reportsMembersSchema>;

export interface ReportsMembersProps {
  members: ReportsMembers;
}

/**
 * Reports "Members" page — a flat dashboard of who carries the project:
 * a completed-quests leaderboard, a stacked contribution area chart with
 * one series per contributor, and a list of idle members. Receives the
 * loader result directly as `props.members`.
 */
const ReportsMembers = (props: ReportsMembersProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const { leaderboard, contributors, contribution, idle } = props.members;

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
      <ReportsSection title={tr("reports.members.leaderboard.title")}>
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
                <UserAvatar
                  fileId={member.picture}
                  className="size-8"
                  alt={member.name}
                />
                <span className="truncate">{member.name}</span>
                <span className="ml-auto shrink-0 text-right tabular-nums">
                  <span className="font-semibold">
                    {member.questsCompleted}
                  </span>{" "}
                  <span className="text-muted-foreground text-xs">
                    {tr("reports.members.label.quests")}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {tr("reports.members.leaderboard.empty")}
          </p>
        )}
      </ReportsSection>

      <ReportsSection title={tr("reports.members.contribution.title")}>
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
            {tr("reports.members.contribution.empty")}
          </p>
        )}
      </ReportsSection>

      <ReportsSection title={tr("reports.members.idle.title")}>
        {idle.length > 0 ? (
          <div className="divide-y divide-border">
            {idle.map((member) => (
              <div
                key={member.userId}
                className="flex items-center gap-3 py-2 text-sm"
              >
                <UserAvatar
                  fileId={member.picture}
                  className="size-8"
                  alt={member.name}
                />
                <span className="truncate">{member.name}</span>
                <span className="text-muted-foreground ml-auto shrink-0">
                  {member.lastCompletedAt
                    ? tr("reports.members.idle.lastCompleted", {
                        args: [dt.of(member.lastCompletedAt).fromNow()],
                      })
                    : tr("reports.members.idle.never")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {tr("reports.members.idle.empty")}
          </p>
        )}
      </ReportsSection>
    </div>
  );
};

export default ReportsMembers;
