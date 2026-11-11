/**
 * The end of a stop: what was earned, and where to go next.
 *
 * Kept short. The reward a child should leave with is the sentence in the
 * middle — that they can now recite this passage knowing what it says — and
 * the stars are there to make coming back for a cleaner run worth it.
 */
import { Link } from "react-router-dom";
import { ArrowRight, Library, RotateCcw, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/providers/I18nProvider";
import type { Stars } from "@/lib/journey/plan";

export function RewardScreen({
  stars,
  passage,
  surahName,
  surahNumber,
  surahDone,
  newWords,
  nextHref,
  onReplay,
}: {
  stars: Stars;
  /** "Al-Ikhlas 1–4", already formatted. */
  passage: string;
  surahName: string;
  surahNumber: number;
  /** This stop was the surah's last unfinished one. */
  surahDone: boolean;
  /** Words this stop put into the reader's vocabulary deck. */
  newWords: number;
  /** The stop after this one, or null at the end of the surah. */
  nextHref: string | null;
  onReplay: () => void;
}) {
  const t = useT();
  const title =
    stars === 3
      ? t("journey.reward.title3")
      : stars === 2
        ? t("journey.reward.title2")
        : t("journey.reward.title1");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div
          className="flex items-end gap-2"
          role="img"
          aria-label={t("journey.stars", { count: stars })}
        >
          {[1, 2, 3].map((n) => (
            <Star
              key={n}
              style={{ "--i": n - 1 } as React.CSSProperties}
              className={cn(
                "journey-star",
                // The middle one stands a little taller, as on a podium.
                n === 2 ? "size-20" : "size-14",
                n <= stars ? "fill-gold text-gold" : "fill-surface-3 text-surface-3",
              )}
              aria-hidden
            />
          ))}
        </div>

        <h1
          className="journey-rise mt-6 text-3xl font-semibold tracking-tight text-fg"
          style={{ "--i": 6 } as React.CSSProperties}
        >
          {surahDone ? t("journey.reward.surahDone", { surah: surahName }) : title}
        </h1>
        <p
          className="journey-rise mt-3 text-[1.0625rem] leading-relaxed text-fg-muted"
          style={{ "--i": 7 } as React.CSSProperties}
        >
          {t("journey.reward.body", { passage })}
        </p>

        {newWords > 0 ? (
          <p
            className="journey-rise mt-5 inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-2 text-[0.875rem] font-medium text-accent-soft-fg"
            style={{ "--i": 8 } as React.CSSProperties}
          >
            <Library className="size-4" aria-hidden />
            {t("journey.reward.words", { count: newWords })}
          </p>
        ) : null}

        {stars < 3 ? (
          <p
            className="journey-rise mt-4 text-[0.8125rem] text-fg-subtle"
            style={{ "--i": 8 } as React.CSSProperties}
          >
            {t("journey.reward.threeStarHint")}
          </p>
        ) : null}

        <div
          className="journey-rise mt-9 flex w-full flex-col gap-2.5"
          style={{ "--i": 9 } as React.CSSProperties}
        >
          {nextHref ? (
            <Button asChild variant="primary" size="lg">
              <Link to={nextHref}>
                {t("journey.reward.next")}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button asChild variant="primary" size="lg">
              <Link to="/journey">
                {t("journey.reward.backToMap")}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          )}
          <Button asChild variant="secondary" size="lg">
            <Link to={`/journey/${surahNumber}`}>{t("journey.reward.backToSurah")}</Link>
          </Button>
          <Button variant="ghost" size="lg" onClick={onReplay}>
            <RotateCcw className="size-4" aria-hidden />
            {t("journey.reward.replay")}
          </Button>
        </div>
      </div>
    </div>
  );
}
