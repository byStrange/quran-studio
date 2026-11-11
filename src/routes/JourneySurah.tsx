/**
 * One surah of the Journey: its stops, and the whole of it to listen to.
 *
 * The stops are where the learning is; "listen to the whole surah" is where it
 * pays off — the same word-by-word recital the first scene of every stop
 * plays, run across the entire surah, which is what a child will want to show
 * someone once they have finished it.
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Headphones, Star, X } from "lucide-react";
import { useJourneyProgress, useJourneySurah, type JourneySurah as SurahData } from "@/hooks/useJourney";
import { useJourneyAudio } from "@/hooks/useJourneyAudio";
import { useUiPrefs } from "@/hooks/useProfile";
import { useSurahs } from "@/hooks/useQuranData";
import { useReadingTimer } from "@/hooks/useReadingTimer";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { VerseArabic } from "@/components/journey/kit";
import { ListenStage } from "@/components/journey/ListenScene";
import { ayahRangeLabel, cn } from "@/lib/utils";
import { useT } from "@/providers/I18nProvider";
import { stopKey } from "@/lib/journey/plan";

export function JourneySurah() {
  const t = useT();
  const params = useParams();
  const surahNumber = Number(params.surahNumber);
  const valid = Number.isInteger(surahNumber) && surahNumber >= 1 && surahNumber <= 114;
  const { data: surahs } = useSurahs();
  const { data, isLoading, error, refetch } = useJourneySurah(valid ? surahNumber : null);
  const { state } = useJourneyProgress();
  const prefs = useUiPrefs();
  const [watching, setWatching] = useState(false);

  const surah = surahs?.find((s) => s.number === surahNumber);

  if (!valid) {
    return (
      <EmptyState
        title={t("journey.surah.notFound")}
        action={
          <Button asChild variant="primary">
            <Link to="/journey">{t("journey.reward.backToMap")}</Link>
          </Button>
        }
      />
    );
  }

  if (watching && data) {
    return (
      <WatchSurah
        data={data}
        surahNumber={surahNumber}
        title={surah?.name_english ?? String(surahNumber)}
        tajweed={prefs.tajweed}
        onClose={() => setWatching(false)}
      />
    );
  }

  // The first stop not yet finished is the one to do next.
  const nextStop = data?.stops.find((stop) => state.stops[stopKey(stop)] === undefined);
  const finished = data !== undefined && data.stops.length > 0 && nextStop === undefined;

  return (
    <div className="journey-stage min-h-full">
      <div className="mx-auto max-w-2xl px-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1.5rem))] pt-[max(1rem,env(safe-area-inset-top))] md:px-8 md:pt-8">
        <Link
          to="/journey"
          className="inline-flex min-h-11 items-center gap-1.5 text-[0.875rem] font-medium text-fg-muted hover:text-fg"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("journey.surah.back")}
        </Link>

        <header className="journey-rise mt-2 text-center">
          <p lang="ar" dir="rtl" className="journey-arabic text-fg">
            {surah?.name_arabic}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            {surahNumber}. {surah?.name_english}
          </h1>
          {surah ? (
            <p className="mt-1 text-[0.9375rem] text-fg-muted">
              {t("common.ayahCount", { count: surah.ayah_count })}
            </p>
          ) : null}
          {finished ? (
            <p className="journey-pop mt-3 inline-flex items-center gap-1.5 rounded-full bg-gold-soft px-3.5 py-1.5 text-[0.8125rem] font-semibold text-gold-soft-fg">
              <Star className="size-3.5 fill-current" aria-hidden />
              {t("journey.surah.finished")}
            </p>
          ) : null}
        </header>

        {isLoading ? (
          <LoadingBlock />
        ) : error || !data ? (
          <div className="mt-8">
            <ErrorState onRetry={() => void refetch()} />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setWatching(true)}
              className="journey-tile journey-rise mt-7 flex w-full items-center gap-4 px-4 py-3.5 text-left"
              style={{ "--i": 1 } as React.CSSProperties}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
                <Headphones className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[0.9375rem] font-semibold text-fg">
                  {t("journey.surah.watch")}
                </span>
                <span className="block text-[0.8125rem] leading-snug text-fg-muted">
                  {t("journey.surah.watchHint")}
                </span>
              </span>
            </button>

            <ol className="mt-6 space-y-3">
              {data.stops.map((stop, position) => {
                const record = state.stops[stopKey(stop)];
                const isNext = nextStop !== undefined && stopKey(stop) === stopKey(nextStop);
                const first = stop.verses[0]!;
                return (
                  <li
                    key={stopKey(stop)}
                    className="journey-rise"
                    style={{ "--i": Math.min(position, 8) + 2 } as React.CSSProperties}
                  >
                    <Link
                      to={`/journey/${stop.surah}/${stop.ayahStart}`}
                      data-state={isNext ? "selected" : undefined}
                      className="journey-tile flex items-center gap-4 px-4 py-3.5"
                    >
                      <span
                        className={cn(
                          "grid size-11 shrink-0 place-items-center rounded-full text-[0.9375rem] font-bold tabular-nums",
                          record
                            ? "bg-gold text-accent-fg"
                            : isNext
                              ? "bg-accent text-accent-fg"
                              : "bg-surface-2 text-fg-muted",
                        )}
                      >
                        {position + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="text-[0.9375rem] font-semibold text-fg">
                            {stop.ayahStart === stop.ayahEnd
                              ? t("journey.surah.ayah", { range: stop.ayahStart })
                              : t("journey.surah.ayahs", {
                                  range: ayahRangeLabel(stop.ayahStart, stop.ayahEnd),
                                })}
                          </span>
                          <span
                            className="flex shrink-0 gap-0.5"
                            role="img"
                            aria-label={t("journey.stars", { count: record?.stars ?? 0 })}
                          >
                            {[1, 2, 3].map((n) => (
                              <Star
                                key={n}
                                className={cn(
                                  "size-4",
                                  record && n <= record.stars
                                    ? "fill-gold text-gold"
                                    : "fill-surface-3 text-surface-3",
                                )}
                                aria-hidden
                              />
                            ))}
                          </span>
                        </span>
                        {/* How the stop begins — the cue a child who knows the
                            surah by ear will recognise it by. */}
                        <span className="mt-0.5 block truncate text-right text-fg-muted" dir="rtl">
                          <VerseArabic verse={first} tajweed={false} className="journey-arabic-sm !text-[1.25rem]" />
                        </span>
                      </span>
                      {isNext ? (
                        <ArrowRight className="size-5 shrink-0 text-accent" aria-hidden />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

/** The whole surah on the listening stage. */
function WatchSurah({
  data,
  surahNumber,
  title,
  tajweed,
  onClose,
}: {
  data: SurahData;
  surahNumber: number;
  title: string;
  tajweed: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const verseIds = useMemo(() => data.verses.map((verse) => verse.id), [data.verses]);
  const audio = useJourneyAudio(surahNumber, verseIds);
  useReadingTimer(data.verses[0]?.ruku ?? null);

  return (
    <div className="journey-stage flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-6">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="grid size-11 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-5" aria-hidden />
        </button>
        <span className="text-[0.9375rem] font-semibold text-fg">{title}</span>
      </header>
      {audio.ready ? (
        <ListenStage
          verses={data.verses}
          audio={audio}
          tajweed={tajweed}
          onDone={onClose}
          doneLabel={t("journey.surah.watchDone")}
        />
      ) : (
        <div className="grid flex-1 place-items-center">
          <LoadingBlock />
        </div>
      )}
    </div>
  );
}
