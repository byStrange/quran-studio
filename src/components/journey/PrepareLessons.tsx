/**
 * Prepare a surah's tafsir lessons ahead of time.
 *
 * A stop's tafsir lesson is written by the AI the first time anyone reaches
 * it, which needs the AI on that device and a few seconds of patience — the
 * two things a child on a phone may not have. Whoever looks after the account
 * can instead press this once per surah on a device where the AI is set up:
 * every stop's lesson is written and cached for all readers, so on the
 * children's devices the scene is simply there.
 *
 * Shown only where it can do something: in the app proper (the AI lives in
 * the Rust backend) and when the reader's language has a tafsir.
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/primitives";
import { fetchCachedJourneyLessonRanges, isTauri } from "@/lib/ai";
import { journeyInsightQuery, useJourneyTafsir } from "@/hooks/useJourneyInsight";
import { useOnline } from "@/hooks/useOnline";
import { useLanguage, useT } from "@/providers/I18nProvider";
import type { Stop } from "@/lib/journey/plan";

export function PrepareLessons({
  stops,
  surahNumber,
  surahName,
}: {
  stops: Stop[];
  surahNumber: number;
  surahName: string;
}) {
  const t = useT();
  const language = useLanguage();
  const tafsir = useJourneyTafsir();
  const online = useOnline();
  const queryClient = useQueryClient();
  const available = isTauri() && tafsir !== null;

  const rangesKey = ["journey-lesson-ranges", tafsir?.edition, surahNumber, language];
  const { data: ready } = useQuery({
    queryKey: rangesKey,
    enabled: available,
    staleTime: 60_000,
    meta: { persist: false },
    queryFn: () => fetchCachedJourneyLessonRanges(tafsir!.edition, surahNumber, language),
  });

  const [progress, setProgress] = useState<{ at: number; of: number } | null>(null);
  const [failed, setFailed] = useState(0);
  const cancelled = useRef(false);

  if (!available || !ready) return null;

  const missing = stops.filter((stop) => !ready.has(`${stop.ayahStart}-${stop.ayahEnd}`));
  const readyCount = stops.length - missing.length;

  const prepare = async () => {
    cancelled.current = false;
    setFailed(0);
    let misses = 0;
    // One at a time: the model answers one request at a time anyway, and a
    // long surah fired all at once would only time most of them out.
    for (let i = 0; i < missing.length; i++) {
      if (cancelled.current) break;
      setProgress({ at: i + 1, of: missing.length });
      const insight = await queryClient
        .fetchQuery({
          ...journeyInsightQuery({ stop: missing[i]!, tafsir: tafsir!, surahName, language }),
          // Ask again even if an earlier, lesser answer is cached in memory.
          staleTime: 0,
        })
        .catch(() => null);
      if (!insight?.forChildren) misses += 1;
    }
    setProgress(null);
    setFailed(misses);
    await queryClient.invalidateQueries({ queryKey: rangesKey });
  };

  return (
    <section className="mt-6 rounded-[1.25rem] border border-border bg-surface/80 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gold-soft text-gold-soft-fg">
          {missing.length === 0 ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Sparkles className="size-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.9375rem] font-semibold text-fg">{t("journey.prepare.title")}</h2>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
            {progress
              ? t("journey.prepare.working", { current: progress.at, total: progress.of })
              : t("journey.prepare.status", { ready: readyCount, total: stops.length })}
            {!progress && missing.length > 0 ? ` ${t("journey.prepare.hint")}` : null}
          </p>
          {progress ? (
            <ProgressBar
              className="mt-2.5"
              tone="gold"
              value={((progress.at - 1) / progress.of) * 100}
            />
          ) : null}
          {failed > 0 && !progress ? (
            <p className="mt-1.5 text-[0.8125rem] text-danger">
              {t("journey.prepare.failed", { count: failed })}
            </p>
          ) : null}
        </div>
        {progress ? (
          <Button variant="secondary" size="sm" onClick={() => (cancelled.current = true)}>
            {t("journey.prepare.stop")}
          </Button>
        ) : missing.length > 0 ? (
          <Button variant="primary" size="sm" disabled={!online} onClick={() => void prepare()}>
            {t("journey.prepare.action")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
