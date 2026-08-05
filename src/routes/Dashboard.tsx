import { useMemo } from "react";
import { Link } from "react-router-dom";
import { BookMarked, Clock, Flame, Library, TrendingUp } from "lucide-react";
import {
  useMemorizationOverview,
  useReadingHistory,
  useReadingOverview,
  useStreak,
} from "@/hooks/useProgress";
import { useProfile } from "@/hooks/useProfile";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader, StatTile } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressBar, Tooltip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/feedback";
import { cn, daysBetween, formatDuration, formatPercent, todayInTimezone } from "@/lib/utils";

export function Dashboard() {
  const { data: profile } = useProfile();
  const { data: streak, isLoading: streakLoading } = useStreak();
  const { data: reading, isLoading: readingLoading } = useReadingOverview();
  const { data: memorization, isLoading: memorizationLoading } = useMemorizationOverview();
  const { data: history } = useReadingHistory(84);

  const timezone = profile?.timezone ?? "UTC";
  const today = todayInTimezone(timezone);

  /** Days remaining to rescue a paused streak, per the 3-day grace rule. */
  const graceDaysLeft = useMemo(() => {
    if (!streak?.grace_expires_on) return null;
    return Math.max(0, daysBetween(today, streak.grace_expires_on));
  }, [streak?.grace_expires_on, today]);

  const percentMemorized =
    memorization && memorization.total_verses > 0
      ? (memorization.verses_memorized / memorization.total_verses) * 100
      : 0;

  const loading = streakLoading || readingLoading || memorizationLoading;

  return (
    <Page
      title="Dashboard"
      description="Your reading time, streak, and memorization progress."
      wide
      action={
        <Button asChild variant="primary">
          <Link to="/browse">Continue reading</Link>
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
              label="Current streak"
              value={`${streak?.current_streak ?? 0}`}
              hint={
                graceDaysLeft !== null
                  ? `Paused · ${graceDaysLeft} ${graceDaysLeft === 1 ? "day" : "days"} to restore`
                  : `Longest: ${streak?.longest_streak ?? 0} days`
              }
              icon={<Flame className="size-4" />}
              accent={(streak?.current_streak ?? 0) > 0}
            />
            <StatTile
              label="Today"
              value={formatDuration(reading?.today_seconds ?? 0)}
              hint={`${formatDuration(reading?.week_seconds ?? 0)} this week`}
              icon={<Clock className="size-4" />}
            />
            <StatTile
              label="Memorized"
              value={`${memorization?.verses_memorized ?? 0}`}
              hint={`${formatPercent(percentMemorized, 2)} of the Quran`}
              icon={<BookMarked className="size-4" />}
            />
            <StatTile
              label="Words learned"
              value={`${memorization?.words_learned ?? 0}`}
              hint={`${memorization?.words_learning ?? 0} in progress`}
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
                      Your {streak?.current_streak ?? 0}-day streak is paused
                    </p>
                    <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
                      You missed a day, but the streak isn't gone. Read for a full hour in a
                      single day within the next{" "}
                      <strong className="font-medium text-fg">
                        {graceDaysLeft} {graceDaysLeft === 1 ? "day" : "days"}
                      </strong>{" "}
                      and it picks up right where it left off.
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Reading activity"
                description="The last 12 weeks. Darker means more time that day."
              />
              <CardBody>
                <ActivityGrid history={history ?? []} today={today} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Progress" />
              <CardBody className="space-y-5">
                <ProgressRow
                  label="Quran memorized"
                  value={percentMemorized}
                  detail={`${memorization?.verses_memorized ?? 0} of ${
                    memorization?.total_verses ?? 6236
                  } ayahs`}
                />
                <ProgressRow
                  label="Surahs completed"
                  value={((memorization?.surahs_completed ?? 0) / 114) * 100}
                  detail={`${memorization?.surahs_completed ?? 0} of 114 surahs`}
                  tone="gold"
                />
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between text-[0.8125rem]">
                    <span className="text-fg-subtle">Total time read</span>
                    <span className="font-medium tabular-nums text-fg">
                      {formatDuration(reading?.total_seconds ?? 0)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[0.8125rem]">
                    <span className="text-fg-subtle">Days with reading</span>
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
}: {
  history: Array<{ day: string; seconds_read: number }>;
  today: string;
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
              seconds > 0 ? `${formatDuration(seconds)} on ${date}` : `No reading on ${date}`
            }
          >
            <div
              className={cn("size-3 rounded-[3px]", LEVELS[level(seconds)])}
              aria-label={`${date}: ${formatDuration(seconds)}`}
            />
          </Tooltip>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 text-[0.6875rem] text-fg-subtle">
        <TrendingUp className="size-3" aria-hidden />
        Less
        {LEVELS.map((cls, i) => (
          <span key={i} className={cn("size-3 rounded-[3px]", cls)} />
        ))}
        More
        <span className="ml-auto">1h+ days restore a paused streak</span>
      </div>
    </div>
  );
}
