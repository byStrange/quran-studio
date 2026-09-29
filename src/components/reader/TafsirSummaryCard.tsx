import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Quote, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import {
  describeAiError,
  fetchCachedTafsirSummary,
  getTafsirSummary,
  isTauri,
  type TafsirSummaryBody,
} from "@/lib/ai";
import { useLanguage, useT } from "@/providers/I18nProvider";
import { cn, verseKey } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";

/**
 * Below this a passage is already short enough to hold in one reading — the
 * Mukhtasar's entries mostly are — and a summary would only restate it.
 */
export const SUMMARY_MIN_CHARS = 1_500;

/**
 * A study summary of the tafsir entry on screen: one line to hang it on, the
 * points worth keeping, questions to test yourself with, and the narrations
 * the commentary quotes, set apart as cards.
 *
 * Like the ruku summary, it is shared across readers and generated only when
 * someone asks, so opening a tafsir is never gated on a model call.
 */
export function TafsirSummaryCard({
  edition,
  tafsirName,
  surahName,
  surahNumber,
  ayahStart,
  ayahEnd,
  content,
  onShowQuote,
}: {
  edition: string;
  tafsirName: string;
  surahName: string;
  surahNumber: number;
  ayahStart: number;
  ayahEnd: number;
  content: string;
  /** Scrolls the commentary above to where a narration appears. */
  onShowQuote: (quote: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const key = { edition, surahNumber, ayahStart };
  const queryKey = ["tafsir-summary", edition, surahNumber, ayahStart, language];

  const cached = useQuery({
    queryKey,
    staleTime: Infinity,
    queryFn: () => fetchCachedTafsirSummary(key, language),
  });

  const generate = useMutation({
    mutationFn: (force: boolean) =>
      getTafsirSummary(
        { ...key, tafsirName, surahName, ayahEnd, content },
        language,
        { force },
      ),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
    onError: (error) => toast(describeAiError(error, t), "error"),
  });

  const summary = cached.data;
  const busy = generate.isPending;

  return (
    <section className="mt-6 rounded-xl border border-accent/20 bg-accent-soft/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-wider text-accent-soft-fg">
          <Sparkles className="size-3.5" aria-hidden />
          {t("tafsirSummary.title")}
        </div>
        {summary && !busy ? (
          <button
            onClick={() => generate.mutate(true)}
            className="inline-flex items-center gap-1 text-[0.6875rem] text-fg-subtle transition-colors hover:text-fg"
            title={t("tafsirSummary.regenerateTitle")}
          >
            <RefreshCw className="size-3" aria-hidden />
            {t("common.regenerate")}
          </button>
        ) : null}
      </div>

      <div className="mt-3">
        {cached.isLoading || busy ? (
          <div className="space-y-2">
            {busy ? (
              <p className="mb-3 text-[0.8125rem] text-fg-subtle">{t("tafsirSummary.generating")}</p>
            ) : null}
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-[92%]" />
            <Skeleton className="h-3.5 w-[85%]" />
            <Skeleton className="h-3.5 w-[60%]" />
          </div>
        ) : summary ? (
          <>
            <SummaryBody body={summary.summary} surahNumber={surahNumber} />
            <p className="mt-4 text-[0.6875rem] leading-relaxed text-fg-subtle">
              {t("tafsirSummary.disclaimer")}
              {summary.model_used ? ` · ${t("summary.generatedBy", { model: summary.model_used })}` : ""}
            </p>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[0.875rem] leading-relaxed text-fg-muted">
              {isTauri() ? t("tafsirSummary.none") : t("summary.needsDesktop")}
            </p>
            {/* Inline as well as the toast: on a phone the panel is a
                full-screen sheet, and the toast can land underneath it. */}
            {generate.isError ? (
              <p className="text-[0.8125rem] leading-relaxed text-danger" role="alert">
                {describeAiError(generate.error, t)}
              </p>
            ) : null}
            {isTauri() ? (
              <Button size="sm" variant="primary" onClick={() => generate.mutate(false)}>
                <WandSparkles className="size-3.5" aria-hidden />
                {t("tafsirSummary.generate")}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {summary && !busy && summary.summary.narrations.length > 0 ? (
        <Narrations narrations={summary.summary.narrations} onShowQuote={onShowQuote} />
      ) : null}
    </section>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">{children}</p>
  );
}

function SummaryBody({ body, surahNumber }: { body: TafsirSummaryBody; surahNumber: number }) {
  const t = useT();

  return (
    <div className="space-y-5" data-selectable>
      {body.gist ? (
        <div>
          <SectionLabel>{t("tafsirSummary.gist")}</SectionLabel>
          <p className="mt-1.5 text-[0.9375rem] font-medium leading-relaxed text-fg">{body.gist}</p>
        </div>
      ) : null}

      {body.key_points.length > 0 ? (
        <div>
          <SectionLabel>{t("tafsirSummary.keyPoints")}</SectionLabel>
          <ol className="mt-2 space-y-2.5">
            {body.key_points.map((point, i) => (
              <li key={i} className="flex gap-3 text-[0.875rem] leading-relaxed text-fg-muted">
                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[0.6875rem] font-semibold tabular-nums text-accent-soft-fg">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  {point.point}
                  {point.ayah !== null ? (
                    <span className="ml-1.5 inline-block rounded bg-surface-2 px-1.5 text-[0.6875rem] tabular-nums text-fg-subtle">
                      {verseKey(surahNumber, point.ayah)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {body.recall.length > 0 ? (
        <div>
          <SectionLabel>{t("tafsirSummary.testYourself")}</SectionLabel>
          <ul className="mt-2 space-y-2">
            {body.recall.map((item, i) => (
              <RecallRow key={`${i}-${item.question}`} question={item.question} answer={item.answer} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The answer stays hidden until asked for: trying to recall before looking is
 * the whole point, and an answer already on screen gets read, not recalled.
 */
function RecallRow({ question, answer }: { question: string; answer: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg border border-border bg-surface/70">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-[0.875rem] leading-relaxed text-fg"
      >
        <ChevronDown
          className={cn("mt-1 size-3.5 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")}
          aria-hidden
        />
        <span className="min-w-0 flex-1">{question}</span>
        {!open ? (
          <span className="shrink-0 text-[0.75rem] text-fg-subtle">{t("tafsirSummary.showAnswer")}</span>
        ) : null}
      </button>
      {open ? (
        <p className="border-t border-border px-3 py-2.5 pl-8 text-[0.8125rem] leading-relaxed text-fg-muted">
          {answer}
        </p>
      ) : null}
    </li>
  );
}

function Narrations({
  narrations,
  onShowQuote,
}: {
  narrations: TafsirSummaryBody["narrations"];
  onShowQuote: (quote: string) => void;
}) {
  const t = useT();

  return (
    <div className="mt-5 border-t border-accent/20 pt-4">
      <SectionLabel>{t("tafsirSummary.narrations")}</SectionLabel>
      <ul className="mt-2.5 space-y-2.5">
        {narrations.map((narration, i) => {
          const attribution = [narration.narrator, narration.source].filter(Boolean).join(" · ");
          return (
            <li
              key={`${i}-${narration.quote}`}
              className="rounded-lg border border-l-[3px] border-border border-l-gold/70 bg-gold-soft/40 px-3.5 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider",
                    narration.kind === "hadith"
                      ? "bg-gold-soft text-gold-soft-fg"
                      : "bg-surface-2 text-fg-subtle",
                  )}
                >
                  {narration.kind === "hadith" ? t("tafsirSummary.hadith") : t("tafsirSummary.athar")}
                </span>
                <button
                  type="button"
                  onClick={() => onShowQuote(narration.quote)}
                  className="inline-flex items-center gap-1 text-[0.6875rem] text-fg-subtle transition-colors hover:text-fg"
                >
                  <Quote className="size-3" aria-hidden />
                  {t("tafsirSummary.showInTafsir")}
                </button>
              </div>
              <p className="mt-2 text-[0.875rem] leading-relaxed text-fg" data-selectable>
                “{narration.text}”
              </p>
              {attribution ? (
                <p className="mt-1.5 text-[0.75rem] text-fg-subtle">— {attribution}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
