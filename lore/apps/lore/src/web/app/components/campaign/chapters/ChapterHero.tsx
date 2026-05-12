import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { cn } from "@alepha/ui/lib/utils";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { BookOpenText, Hourglass, Square, Swords } from "lucide-react";
import type { I18n } from "@/web/app/services/I18n.ts";
import type { ChapterWithCount } from "./CampaignChapters.tsx";

export interface ChapterHeroProps {
  chapter: ChapterWithCount;
  onClose: () => void;
  onOpenDetail: () => void;
}

/**
 * Hero panel for the currently-active chapter. Renders like an open book
 * page: ornate left rail with the chapter number, large display-font
 * title, live stats, tag chips, and (when `closesAt` is set) a deadline
 * progress bar that fills as the chapter ages.
 */
const ChapterHero = (props: ChapterHeroProps) => {
  const { chapter } = props;
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const tags = chapter.tags ?? [];

  const now = dt.nowMillis();
  const startedAt = new Date(chapter.createdAt).getTime();
  const ageMs = Math.max(0, now - startedAt);
  const totalMs =
    chapter.closesAt != null
      ? Math.max(1, new Date(chapter.closesAt).getTime() - startedAt)
      : null;
  const progress =
    totalMs != null ? Math.min(100, Math.round((ageMs / totalMs) * 100)) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onOpenDetail();
        }
      }}
      className={cn(
        "group relative flex w-full cursor-pointer flex-col overflow-hidden rounded-2xl border text-left transition-shadow hover:shadow-lg",
        "bg-card",
      )}
    >
      {/* Glow accent rail */}
      <div className="from-primary/80 to-primary/40 absolute inset-y-0 left-0 w-1 bg-gradient-to-b" />

      {/* Animated ambient glow */}
      <div className="from-primary/10 via-background to-background absolute inset-0 -z-10 bg-gradient-to-br opacity-60" />

      <div className="grid gap-6 p-6 md:grid-cols-[auto_1fr] md:gap-8 md:p-8">
        {/* Numbered medallion */}
        <div className="flex flex-col items-center gap-3">
          <div className="from-primary/90 to-primary text-primary-foreground relative flex size-20 items-center justify-center rounded-full bg-gradient-to-br shadow-lg ring-4 ring-background">
            <span className="font-display text-3xl font-bold leading-none">
              {chapter.number}
            </span>
            <span className="absolute -bottom-1 right-0 size-3 animate-pulse rounded-full bg-green-500 ring-2 ring-background" />
          </div>
          <Badge className="bg-green-600 text-[10px] uppercase tracking-widest text-white">
            {tr("chapter.banner.active")}
          </Badge>
        </div>

        {/* Title + meta */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
              {tr("chapter.hero.eyebrow", {
                args: [String(chapter.number)],
              })}
            </span>
            <h2 className="font-display truncate text-3xl font-bold leading-tight md:text-4xl">
              {chapter.title}
            </h2>
            {chapter.description && (
              <p className="text-muted-foreground line-clamp-2 text-sm italic">
                {chapter.description}
              </p>
            )}
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="border-primary/40 text-primary font-mono text-[11px]"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Live stats */}
          <dl className="grid grid-cols-2 gap-4 pt-1 sm:grid-cols-4">
            <Stat
              icon={<Swords className="size-4" />}
              label={tr("chapter.hero.stat.quests")}
              value={chapter.questCount}
            />
            <Stat
              icon={<BookOpenText className="size-4" />}
              label={tr("chapter.hero.stat.tags")}
              value={tags.length}
            />
            <Stat
              icon={<Hourglass className="size-4" />}
              label={tr("chapter.hero.stat.started")}
              value={dt.of(chapter.createdAt).fromNow(true)}
              text
            />
            {chapter.closesAt && (
              <Stat
                icon={<Hourglass className="size-4" />}
                label={tr("chapter.hero.stat.closesIn")}
                value={dt.of(chapter.closesAt).fromNow(true)}
                text
              />
            )}
          </dl>

          {/* Deadline progress */}
          {progress != null && (
            <div className="flex flex-col gap-1">
              <div className="text-muted-foreground flex justify-between text-[11px] uppercase tracking-wider">
                <span>{tr("chapter.hero.progress")}</span>
                <span className="font-mono">{progress}%</span>
              </div>
              <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    progress < 70 ? "bg-primary" : "bg-amber-500",
                    progress >= 95 && "bg-red-500",
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              variant="outline"
              className="border-amber-500/60 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
              onClick={(e) => {
                e.stopPropagation();
                props.onClose();
              }}
            >
              <Square className="size-4" />
              {tr("chapter.close")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface StatProps {
  icon: React.ReactNode;
  label: string | number;
  value: number | string;
  text?: boolean;
}

const Stat = (props: StatProps) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-muted-foreground flex items-center gap-1 text-[10px] uppercase tracking-wider">
      {props.icon}
      {props.label}
    </dt>
    <dd
      className={cn(
        "font-semibold",
        props.text ? "text-sm" : "font-display text-2xl",
      )}
    >
      {props.value}
    </dd>
  </div>
);

export default ChapterHero;
