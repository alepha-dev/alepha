import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  ChartBar,
  Star,
  Target,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { I18n } from "../../services/I18n.ts";

export interface CampaignStatsProps {
  stats: {
    overview: {
      totalQuests: number;
      completedQuests: number;
      activeAdventurers: number;
      totalXP: number;
      averageQuestDifficulty: number;
    };
    questsByPriority: Array<{
      priority: string;
      count: number;
      completed: number;
    }>;
    questsByDifficulty: Array<{
      difficulty: number;
      count: number;
      averageXP: number;
    }>;
    topZones: Array<{
      zone: string;
      totalQuests: number;
    }>;
    activityTimeline: Array<{
      date: string;
      questsCompleted: number;
    }>;
    completionRate: {
      weekly: number;
      monthly: number;
      overall: number;
    };
  };
}

const CampaignStats = (props: CampaignStatsProps) => {
  const stats = props.stats;
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const [timelineRange, setTimelineRange] = useState<string>("14days");

  const priorityData = stats.questsByPriority.map((item) => ({
    priority: item.priority.charAt(0).toUpperCase() + item.priority.slice(1),
    total: item.count,
    completed: item.completed,
    remaining: item.count - item.completed,
  }));

  const difficultyData = stats.questsByDifficulty.map((item) => ({
    difficulty: `Level ${item.difficulty}`,
    count: item.count,
    averageXP: item.averageXP,
  }));

  const zonesData = stats.topZones.map((zone) => ({
    zone:
      zone.zone.length > 15 ? `${zone.zone.substring(0, 15)}...` : zone.zone,
    fullZone: zone.zone,
    totalQuests: zone.totalQuests,
  }));

  const getFilteredTimelineData = () => {
    const now = new Date(dt.nowMillis());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let cutoffDate: Date;
    let aggregateByWeek = false;
    let aggregateByMonth = false;

    switch (timelineRange) {
      case "7days":
        cutoffDate = new Date(today);
        cutoffDate.setDate(cutoffDate.getDate() - 6);
        break;
      case "14days":
        cutoffDate = new Date(today);
        cutoffDate.setDate(cutoffDate.getDate() - 13);
        break;
      case "30days":
        cutoffDate = new Date(today);
        cutoffDate.setDate(cutoffDate.getDate() - 29);
        break;
      case "90days":
        cutoffDate = new Date(today);
        cutoffDate.setDate(cutoffDate.getDate() - 89);
        aggregateByWeek = true;
        break;
      case "1year":
        cutoffDate = new Date(today);
        cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
        aggregateByMonth = true;
        break;
      case "all":
        cutoffDate = new Date(0);
        aggregateByMonth = true;
        break;
      default:
        cutoffDate = new Date(today);
        cutoffDate.setDate(cutoffDate.getDate() - 13);
    }

    const filteredData = stats.activityTimeline.filter(
      (item) => new Date(item.date) >= cutoffDate,
    );

    if (aggregateByWeek) {
      const weekMap = new Map<string, number>();
      for (const item of filteredData) {
        const date = new Date(item.date);
        const monday = new Date(date);
        const day = monday.getDay();
        const diff = monday.getDate() - day + (day === 0 ? -6 : 1);
        monday.setDate(diff);
        monday.setHours(0, 0, 0, 0);
        const weekKey = monday.toISOString().split("T")[0];
        weekMap.set(
          weekKey,
          (weekMap.get(weekKey) || 0) + item.questsCompleted,
        );
      }
      return Array.from(weekMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([weekStart, quests]) => ({
          date: new Date(weekStart).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          }),
          quests,
        }));
    }

    if (aggregateByMonth) {
      const monthMap = new Map<string, number>();
      for (const item of filteredData) {
        const date = new Date(item.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        monthMap.set(
          monthKey,
          (monthMap.get(monthKey) || 0) + item.questsCompleted,
        );
      }
      return Array.from(monthMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([monthKey, quests]) => {
          const [year, month] = monthKey.split("-");
          const date = new Date(Number(year), Number(month) - 1, 1);
          return {
            date: date.toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            }),
            quests,
          };
        });
    }

    return filteredData.map((item) => ({
      date: new Date(item.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      quests: item.questsCompleted,
    }));
  };

  const timelineData = getFilteredTimelineData();

  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <ChartBar className="size-6" />
          <h2 className="text-xl font-semibold">{tr("stats.title")}</h2>
        </div>

        <p className="text-muted-foreground text-sm">{tr("stats.subtitle")}</p>

        {/* Overview Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            icon={<Target className="size-5 opacity-60" />}
            value={stats.overview.totalQuests}
            label={String(tr("stats.totalQuests"))}
          />
          <StatCard
            icon={<Trophy className="size-5 opacity-60" />}
            value={stats.overview.completedQuests}
            label={String(tr("stats.completed"))}
          />
          <StatCard
            icon={<Users className="size-5 opacity-60" />}
            value={stats.overview.activeAdventurers}
            label={String(tr("stats.activeAdventurers"))}
          />
          <StatCard
            icon={<Star className="size-5 opacity-60" />}
            value={stats.overview.totalXP.toLocaleString()}
            label={String(tr("stats.totalXp"))}
          />
        </div>

        {/* Activity Timeline */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-5" />
              {tr("stats.timeline")}
            </CardTitle>
            <Select
              value={timelineRange}
              onValueChange={(v) => setTimelineRange(v || "14days")}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7days">Last 7 Days</SelectItem>
                <SelectItem value="14days">Last 14 Days</SelectItem>
                <SelectItem value="30days">Last 30 Days</SelectItem>
                <SelectItem value="90days">Last 90 Days</SelectItem>
                <SelectItem value="1year">Last Year</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {timelineData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="quests"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {tr("stats.noActivity")}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Top Zones */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tr("stats.topZones")}</CardTitle>
          </CardHeader>
          <CardContent>
            {zonesData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={zonesData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="zone" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="totalQuests" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {tr("stats.noZones")}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* By Priority */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {tr("stats.byPriority")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {priorityData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={priorityData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="priority" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="completed" fill="#10b981" stackId="a" />
                    <Bar dataKey="remaining" fill="#9ca3af" stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  {tr("stats.noData")}
                </p>
              )}
            </CardContent>
          </Card>

          {/* By Difficulty */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {tr("stats.byDifficulty")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {difficultyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={difficultyData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="difficulty" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6366f1" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  {tr("stats.noData")}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

interface StatCardProps {
  icon: React.ReactNode;
  value: number | string;
  label: string;
}

const StatCard = (props: StatCardProps) => {
  return (
    <Card className="gap-0 py-0 shadow-sm">
      <CardContent className="flex items-center gap-3 p-4">
        {props.icon}
        <div className="flex flex-1 flex-col">
          <span className="text-xl font-bold">{props.value}</span>
          <span className="text-muted-foreground text-sm">{props.label}</span>
        </div>
      </CardContent>
    </Card>
  );
};

export default CampaignStats;
