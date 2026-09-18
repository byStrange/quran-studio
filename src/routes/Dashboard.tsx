import { useMemo } from "react";
import { Link } from "react-router-dom";
import { BookMarked, Clock, Flame, Library, TrendingUp } from "lucide-react";
import {
  useMemorizationOverview,
  useReadingHistory,
  useReadingOverview,
  useStreak,
  useStreakStatus,
} from "@/hooks/useProgress";
import { useProfile } from "@/hooks/useProfile";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader, StatTile } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressBar, Tooltip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/feedback";
import { cn, formatDuration, formatPercent, todayInTimezone, type DurationUnits } from "@/lib/utils";
import { useDurationUnits, useT, type TFunction } from "@/providers/I18nProvider";

export function Dashboard() {
  const t = useT();
  const units = useDurationUnits();
  const { data: profile } = useProfile();
  const { isLoading: streakLoading } = useStreak();
  const { streak, graceDaysLeft } = useStreakStatus();
  const { data: reading, isLoading: readingLoading } = useReadingOverview();
  const { data: memorization, isLoading: memorizationLoading } = useMemorizationOverview();
  const { data: history } = useReadingHistory(84);

  const timezone = profile?.timezone ?? "UTC";
  const today = todayInTimezone(timezone);

  const percentMemorized =
    memorization && memorization.total_verses > 0
      ? (memorization.verses_memorized / memorization.total_verses) * 100
      : 0;

  const loading = streakLoading || readingLoading || memorizationLoading;

  return (
    <Page
      title={t("dashboard.title")}
      description={t("dashboard.description")}
      wide
      action={
        <Button asChild variant="primary">
          <Link to="/browse">{t("dashboard.continueReading")}</Link>
        </Button>
      }
    >
      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-card" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label={t("dashboard.currentStreak")}
              value={`${streak?.current_streak ?? 0}`}
              hint={
                graceDaysLeft !== null
                  ? graceDaysLeft === 1
                    ? t("dashboard.lastDayToRestore")
                    : t("dashboard.daysToRestore", { count: graceDaysLeft })
                  : t("dashboard.longest", { count: streak?.longest_streak ?? 0 })
              }
              icon={<Flame className="size-4" />}
              accent={(streak?.current_streak ?? 0) > 0}
            />
            <StatTile
              label={t("dashboard.today")}
              value={formatDuration(reading?.today_seconds ?? 0, units)}
              hint={t("dashboard.thisWeek", {
                duration: formatDuration(reading?.week_seconds ?? 0, units),
              })}
              icon={<Clock className="size-4" />}
            />
            <StatTile
              label={t("dashboard.memorized")}
              value={`${memorization?.verses_memorized ?? 0}`}
              hint={t("dashboard.ofTheQuran", { percent: formatPercent(percentMemorized, 2) })}
              icon={<BookMarked className="size-4" />}
            />
            <StatTile
              label={t("dashboard.wordsLearned")}
              value={`${memorization?.words_learned ?? 0}`}
              hint={t("dashboard.inProgress", { count: memorization?.words_learning ?? 0 })}
              icon={<Library className="size-4" />}
            />
          </div>

          {graceDaysLeft !== null ? (
            <Card className="mt-4 border-warning/40 bg-gold-soft/40">
              <CardBody className="pt-5">
                <div className="flex items-start gap-3">
                  <Flame className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-fg">
                      {t("dashboard.streakPausedTitle", { count: streak?.current_streak ?? 0 })}
                    </p>
                    {/* The deadline is emboldened inside the sentence, so the
                        sentence is split on its placeholder rather than
                        assembled from two half-sentences — the surrounding
                        grammar differs per language and only the full string
                        carries it. */}
                    <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
                      <Emphasised
                        template={t("dashboard.streakPausedBody")}
                        placeholder="{deadline}"
                        value={
                          graceDaysLeft === 1
                            ? t("dashboard.deadlineToday")
                            : t("dashboard.deadlineDays", { count: graceDaysLeft ?? 0 })
                        }
                      />
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title={t("dashboard.activityTitle")}
                description={t("dashboard.activityDescription")}
              />
              <CardBody>
                <ActivityGrid history={history ?? []} today={today} t={t} units={units} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t("dashboard.progressTitle")} />
              <CardBody className="space-y-5">
                <ProgressRow
                  label={t("dashboard.quranMemorized")}
                  value={percentMemorized}
                  detail={t("dashboard.ayahsOf", {
                    memorized: memorization?.verses_memorized ?? 0,
                    total: memorization?.total_verses ?? 6236,
                  })}
                />
                <ProgressRow
                  label={t("dashboard.surahsCompleted")}
                  value={((memorization?.surahs_completed ?? 0) / 114) * 100}
                  detail={t("dashboard.surahsOf", { completed: memorization?.surahs_completed ?? 0 })}
                  tone="gold"
                />
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between text-[0.8125rem]">
                    <span className="text-fg-subtle">{t("dashboard.totalTimeRead")}</span>
                    <span className="font-medium tabular-nums text-fg">
                      {formatDuration(reading?.total_seconds ?? 0, units)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[0.8125rem]">
                    <span className="text-fg-subtle">{t("dashboard.daysWithReading")}</span>
                    <span className="font-medium tabular-nums text-fg">
                      {reading?.days_read ?? 0}
                    </span>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}

function ProgressRow({
  label,
  value,
  detail,
  tone = "accent",
}: {
  label: string;
  value: number;
  detail: string;
  tone?: "accent" | "gold";
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[0.8125rem] font-medium text-fg">{label}</span>
        <span className="text-[0.8125rem] tabular-nums text-fg-subtle">
          {formatPercent(value, 1)}
        </span>
      </div>
      <ProgressBar value={value} tone={tone} />
      <p className="mt-1.5 text-[0.75rem] text-fg-subtle">{detail}</p>
    </div>
  );
}

/** GitHub-style contribution grid over daily reading totals. */
function ActivityGrid({
  history,
  today,
  t,
  units,
}: {
  history: Array<{ day: string; seconds_read: number }>;
  today: string;
  t: TFunction;
  units: DurationUnits;
}) {
  const byDay = useMemo(
    () => new Map(history.map((row) => [row.day, row.seconds_read])),
    [history],
  );

  const days = useMemo(() => {
    const out: Array<{ date: string; seconds: number }> = [];
    const end = new Date(`${today}T00:00:00Z`);
    for (let i = 83; i >= 0; i--) {
      const date = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      out.push({ date, seconds: byDay.get(date) ?? 0 });
    }
    return out;
  }, [byDay, today]);

  // Four buckets: none, under 15m, under 1h, and the 1h+ tier that also
  // satisfies the streak-restore rule.
  function level(seconds: number): 0 | 1 | 2 | 3 {
    if (seconds <= 0) return 0;
    if (seconds < 900) return 1;
    if (seconds < 3600) return 2;
    return 3;
  }

  const LEVELS = [
    "bg-surface-3",
    "bg-accent/30",
    "bg-accent/60",
    "bg-accent",
  ] as const;

  return (
    <div>
      {/* w-fit keeps the columns cell-sized; without it the grid stretches to
          the card width and the weeks drift apart. */}
      <div className="grid w-fit grid-flow-col grid-rows-7 gap-1">
        {days.map(({ date, seconds }) => (
          <Tooltip
            key={date}
            content={
              seconds > 0
                ? t("dashboard.readOn", { duration: formatDuration(seconds, units), date })
                : t("dashboard.noReadingOn", { date })
            }
          >
            <div
              className={cn("size-3 rounded-[3px]", LEVELS[level(seconds)])}
              aria-label={`${date}: ${formatDuration(seconds, units)}`}
            />
          </Tooltip>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 text-[0.6875rem] text-fg-subtle">
        <TrendingUp className="size-3" aria-hidden />
        {t("dashboard.less")}
        {LEVELS.map((cls, i) => (
          <span key={i} className={cn("size-3 rounded-[3px]", cls)} />
        ))}
        {t("dashboard.more")}
        <span className="ml-auto">{t("dashboard.restoreHint")}</span>
      </div>
    </div>
  );
}

/**
 * A sentence with one emphasised span inside it.
 *
 * The alternative — three JSX fragments with the bold bit in the middle — puts
 * the sentence's word order in the component rather than in the dictionary,
 * and word order is the first thing a translation changes. So the string stays
 * whole, carries a placeholder, and is split on it here.
 */
function Emphasised({
  template,
  placeholder,
  value,
}: {
  template: string;
  placeholder: string;
  value: string;
}) {
  // `t` leaves a placeholder it was given no parameter for untouched, which is
  // what makes splitting on it here work.
  const [before, after = ""] = template.split(placeholder);
  return (
    <>
      {before}
      <strong className="font-medium text-fg">{value}</strong>
      {after}
    </>
  );
}
