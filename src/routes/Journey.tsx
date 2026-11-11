/**
 * The Journey map: every surah as a station along a path.
 *
 * The path is a suggestion and never a gate. A child comes here already able
 * to recite some surahs — which ones depends on their teacher, not on this
 * app — and the first thing they should be able to do is open one of those
 * and find out what it says. So every station is open from the start; the map
 * only says where they have been, and points at one to go to next.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Flame, MapPin, Star } from "lucide-react";
import { useSurahs } from "@/hooks/useQuranData";
import { needsGlossChoice, resolveGlossLanguage, useJourneyProgress } from "@/hooks/useJourney";
import { useStreakStatus } from "@/hooks/useProgress";
import { Page } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { useLanguage, useT } from "@/providers/I18nProvider";
import type { Surah } from "@/lib/types";
import {
  JOURNEY_PATH,
  nextSurah,
  tallyBySurah,
  totalStars,
  type GlossLanguage,
  type SurahTally,
} from "@/lib/journey/progress";

/** Where Juz 30 begins: An-Naba. Everything from here to An-Nas is the trail. */
const JUZ_30_FIRST = 78;

/**
 * How far each station sits from the centre line, as a repeating wave. The
 * stations are a column either way; the wave is what makes the column read as
 * a road going somewhere rather than as a list.
 */
const WAVE = [0, 34, 58, 34, 0, -34, -58, -34];

export function Journey() {
  const t = useT();
  const language = useLanguage();
  const { data: surahs, isLoading, error, refetch } = useSurahs();
  const { state, setGlossLanguage } = useJourneyProgress();
  const { streak } = useStreakStatus();

  const tally = useMemo(() => tallyBySurah(state), [state]);
  const done = useMemo(() => new Set(state.surahsDone), [state.surahsDone]);
  const upNext = nextSurah(state);
  const byNumber = useMemo(() => new Map((surahs ?? []).map((s) => [s.number, s])), [surahs]);

  const trail = JOURNEY_PATH.filter((n) => n === 1 || n >= JUZ_30_FIRST);
  const rest = JOURNEY_PATH.filter((n) => n !== 1 && n < JUZ_30_FIRST);
  const upNextSurah = byNumber.get(upNext);
  const stopsDone = Object.keys(state.stops).length;

  return (
    <Page title={t("journey.title")} description={t("journey.subtitle")}>
      {isLoading ? (
        <LoadingBlock />
      ) : error || !surahs ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <div className="space-y-8">
          {/* Where to go now. One button, so a child who opens the app with
              ten minutes does not spend them choosing. */}
          {upNextSurah ? (
            <section className="journey-stage journey-rise overflow-hidden rounded-[1.25rem] border border-border p-5 md:p-7">
              <p className="flex items-center gap-1.5 text-[0.75rem] font-semibold uppercase tracking-wider text-accent-soft-fg">
                <MapPin className="size-3.5" aria-hidden />
                {t("journey.nextUp")}
              </p>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                  <p lang="ar" dir="rtl" className="journey-arabic !leading-[1.6] text-fg">
                    {upNextSurah.name_arabic}
                  </p>
                  <p className="mt-1 text-[1.0625rem] font-semibold text-fg">
                    {upNextSurah.number}. {upNextSurah.name_english}
                  </p>
                  <p className="text-[0.875rem] text-fg-muted">
                    {t("common.ayahCount", { count: upNextSurah.ayah_count })}
                  </p>
                </div>
                <Button asChild variant="primary" size="lg" className="min-w-40">
                  <Link to={`/journey/${upNextSurah.number}`}>
                    {tally.has(upNextSurah.number) ? t("journey.continue") : t("journey.start")}
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              </div>
              <div className="mt-5 flex flex-wrap gap-2 text-[0.8125rem] font-medium">
                <Stat icon={<Star className="size-3.5 fill-gold text-gold" aria-hidden />}>
                  {t("journey.stars", { count: totalStars(state) })}
                </Stat>
                <Stat icon={<Check className="size-3.5 text-accent" aria-hidden />}>
                  {t("journey.stopsDone", { count: stopsDone })}
                </Stat>
                <Stat icon={<Check className="size-3.5 text-accent" aria-hidden />}>
                  {t("journey.surahsDone", { count: state.surahsDone.length })}
                </Stat>
                {streak && streak.current_streak > 0 ? (
                  <Stat icon={<Flame className="size-3.5 text-accent" aria-hidden />}>
                    {t("common.dayCount", { count: streak.current_streak })}
                  </Stat>
                ) : null}
              </div>
            </section>
          ) : null}

          {needsGlossChoice(language) ? (
            <GlossChoice
              value={resolveGlossLanguage(language, state.glossLanguage)}
              onChange={setGlossLanguage}
            />
          ) : null}

          <section>
            <h2 className="mb-1 text-[0.75rem] font-semibold uppercase tracking-wider text-fg-subtle">
              {t("journey.section.juz30")}
            </h2>
            <ol className="relative mx-auto flex max-w-md flex-col items-center gap-5 py-6">
              {/* The road itself, behind the stations. */}
              <span
                className="absolute inset-y-6 left-1/2 w-0 -translate-x-1/2 border-l-2 border-dashed border-border-strong/70"
                aria-hidden
              />
              {trail.map((number, position) => {
                const surah = byNumber.get(number);
                if (!surah) return null;
                return (
                  <li
                    key={number}
                    className="relative"
                    style={{ transform: `translateX(${WAVE[position % WAVE.length]}px)` }}
                  >
                    <Station
                      surah={surah}
                      tally={tally.get(number)}
                      done={done.has(number)}
                      upNext={number === upNext}
                    />
                  </li>
                );
              })}
            </ol>
          </section>

          <section>
            <h2 className="mb-3 text-[0.75rem] font-semibold uppercase tracking-wider text-fg-subtle">
              {t("journey.section.rest")}
            </h2>
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
              {rest.map((number) => {
                const surah = byNumber.get(number);
                if (!surah) return null;
                const mine = tally.get(number);
                return (
                  <li key={number}>
                    <Link
                      to={`/journey/${number}`}
                      className={cn(
                        "journey-tile flex h-full items-center gap-3 px-3 py-2.5 text-left",
                        done.has(number) && "!border-gold",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-full text-[0.8125rem] font-semibold tabular-nums",
                          done.has(number)
                            ? "bg-gold text-accent-fg"
                            : mine
                              ? "bg-accent-soft text-accent-soft-fg"
                              : "bg-surface-2 text-fg-muted",
                        )}
                      >
                        {number}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[0.875rem] font-medium text-fg">
                          {surah.name_english}
                        </span>
                        <span className="block text-[0.75rem] text-fg-subtle">
                          {mine
                            ? t("journey.stars", { count: mine.stars })
                            : t("common.ayahCount", { count: surah.ayah_count })}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </Page>
  );
}

function Stat({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/80 px-3 py-1.5 text-fg-muted">
      {icon}
      {children}
    </span>
  );
}

/** One surah on the trail: a round station with its name beneath. */
function Station({
  surah,
  tally,
  done,
  upNext,
}: {
  surah: Surah;
  tally: SurahTally | undefined;
  done: boolean;
  upNext: boolean;
}) {
  const t = useT();
  return (
    <Link
      to={`/journey/${surah.number}`}
      className="group flex w-44 flex-col items-center rounded-2xl text-center"
    >
      <span
        className={cn(
          "relative grid size-[4.5rem] place-items-center rounded-full border-[3px] border-b-[6px] text-[1.125rem] font-bold tabular-nums",
          "transition-transform group-active:translate-y-0.5",
          done
            ? "border-gold bg-gold text-accent-fg"
            : tally
              ? "border-accent bg-accent-soft text-accent-soft-fg"
              : upNext
                ? "border-accent bg-accent text-accent-fg"
                : "border-border-strong bg-surface text-fg-muted",
          upNext && !done && "journey-pulse",
        )}
      >
        {done ? <Star className="size-7 fill-current" aria-hidden /> : surah.number}
      </span>
      {/* On the page colour, so the dashed road does not run through the name. */}
      <span className="mt-1.5 rounded-lg bg-bg px-2 py-0.5">
        <span className="block text-[0.9375rem] font-semibold leading-tight text-fg">
          {surah.name_english}
        </span>
        <span className="block text-[0.75rem] text-fg-subtle">
          {tally
            ? t("journey.stars", { count: tally.stars })
            : t("common.ayahCount", { count: surah.ayah_count })}
        </span>
      </span>
    </Link>
  );
}

const GLOSS_OPTIONS: ReadonlyArray<{ value: GlossLanguage; label: string }> = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
];

/**
 * Which language word meanings are shown in, for a reader whose own language
 * has no word-by-word corpus. Asked here rather than buried in Settings: it
 * decides whether the word games can be read at all.
 */
function GlossChoice({
  value,
  onChange,
}: {
  value: GlossLanguage;
  onChange: (language: GlossLanguage) => void;
}) {
  const t = useT();
  return (
    <section className="rounded-[1.25rem] border border-border bg-surface p-4 md:p-5">
      <h2 className="text-[0.9375rem] font-semibold text-fg">{t("journey.glossChoice.title")}</h2>
      <p className="mt-1 max-w-prose text-[0.875rem] leading-relaxed text-fg-muted">
        {t("journey.glossChoice.body")}
      </p>
      <div className="mt-3 flex gap-2" role="radiogroup" aria-label={t("journey.glossChoice.title")}>
        {GLOSS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            data-state={value === option.value ? "selected" : undefined}
            onClick={() => onChange(option.value)}
            className="journey-tile min-h-11 px-5 text-[0.9375rem] font-medium"
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
