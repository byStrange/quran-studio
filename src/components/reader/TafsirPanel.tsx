import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, GraduationCap } from "lucide-react";
import { useTafsirEditions, useTafsirForAyah } from "@/hooks/useQuranData";
import { useUiPrefs, useUpdateProfile } from "@/hooks/useProfile";
import { useLanguage, useT } from "@/providers/I18nProvider";
import { editionMatchesLanguage } from "@/lib/language";
import { ayahRangeLabel, cn, toParagraphs } from "@/lib/utils";
import { DEFAULT_TAFSIR_EDITION } from "@/lib/types";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { SelectField } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { SUMMARY_MIN_CHARS, TafsirSummaryCard } from "./TafsirSummaryCard";

/**
 * Text reduced to its words, for finding a narration's quote among the
 * paragraphs: case, punctuation and Arabic diacritics dropped, as the backend
 * does when it checks the quote in the first place.
 */
function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF\u0640]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function TafsirPanel({
  surahNumber,
  ayahNumber,
  surahName,
  /** Ayah numbers covered by the entry on screen that are already marked read. */
  readAyahs,
  onToggleRead,
}: {
  surahNumber: number | null;
  ayahNumber: number | null;
  surahName: string;
  readAyahs: Set<number>;
  /** Marks or unmarks every ayah the displayed entry covers. */
  onToggleRead: (ayahStart: number, ayahEnd: number, read: boolean) => void;
}) {
  const t = useT();
  const prefs = useUiPrefs();
  const language = useLanguage();
  const updateProfile = useUpdateProfile();
  const { data: editions } = useTafsirEditions();

  /**
   * The stored choice, checked against what is actually seeded.
   *
   * Before the list loads the stored slug is trusted, so switching editions
   * and reloading doesn't flash the default one first. Once it has loaded, a
   * slug that no longer exists falls back rather than querying for an edition
   * that would return nothing.
   */
  const edition = useMemo(() => {
    if (!editions) return prefs.tafsirEdition;
    if (editions.some((e) => e.slug === prefs.tafsirEdition)) return prefs.tafsirEdition;
    // Nothing stored, or a slug from a seed this database no longer has. An
    // edition in the reader's own content language beats the English default:
    // a Russian reader who has never touched this picker should not have to
    // find it before the commentary is readable.
    return (
      editions.find((e) => editionMatchesLanguage(e, language))?.slug ??
      editions.find((e) => e.slug === DEFAULT_TAFSIR_EDITION)?.slug ??
      editions[0]?.slug ??
      DEFAULT_TAFSIR_EDITION
    );
  }, [editions, prefs.tafsirEdition, language]);

  const active = editions?.find((e) => e.slug === edition);
  const { data, isLoading, isError, refetch } = useTafsirForAyah(surahNumber, ayahNumber, edition);

  /**
   * Whether the entry on screen counts as read.
   *
   * An entry spanning 2:1-5 is one act of reading, so it is "read" only when
   * every ayah it covers is marked — a partially marked range (from having
   * marked a single ayah in the reader) still offers the button.
   */
  const coveredAyahs = useMemo(() => {
    if (!data) return [];
    const ayahs: number[] = [];
    for (let ayah = data.ayah_start; ayah <= data.ayah_end; ayah++) ayahs.push(ayah);
    return ayahs;
  }, [data]);

  const allRead = coveredAyahs.length > 0 && coveredAyahs.every((ayah) => readAyahs.has(ayah));

  const paragraphs = useMemo(() => (data ? toParagraphs(data.content) : []), [data]);
  const paragraphRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const [flashed, setFlashed] = useState<number | null>(null);

  // A highlight belongs to the entry it was found in.
  useEffect(() => setFlashed(null), [data]);
  useEffect(() => {
    if (flashed === null) return;
    const timer = window.setTimeout(() => setFlashed(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [flashed]);

  /** Scrolls to the paragraph a narration card was quoted from. */
  const showQuote = useCallback(
    (quote: string) => {
      const needle = foldForSearch(quote);
      if (!needle) return;
      const index = paragraphs.findIndex((paragraph) => foldForSearch(paragraph).includes(needle));
      if (index < 0) return;
      paragraphRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashed(index);
    },
    [paragraphs],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border px-4 py-3 md:px-5 md:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
            <BookOpen className="size-3.5" aria-hidden />
            {t("tafsir.title")}
          </div>
          {editions && editions.length > 1 ? (
            <SelectField
              value={edition}
              onValueChange={(value) =>
                updateProfile.mutate({ ui_prefs: { tafsirEdition: value } })
              }
              options={editions.map((e) => ({
                value: e.slug,
                label: `${e.name} · ${e.language_name}`,
              }))}
              className="h-8 w-auto max-w-[14rem] shrink-0 px-2.5 text-[0.8125rem]"
            />
          ) : null}
        </div>
        {data ? (
          <div className="mt-1.5 text-sm font-medium text-fg">
            {surahName} {ayahRangeLabel(data.ayah_start, data.ayah_end)}
            {data.ayah_start !== data.ayah_end ? (
              <span className="ml-2 text-[0.8125rem] font-normal text-fg-subtle">
                {t("tafsir.covers", { count: data.ayah_end - data.ayah_start + 1 })}
              </span>
            ) : null}
          </div>
        ) : ayahNumber ? (
          <div className="mt-1.5 text-sm font-medium text-fg">
            {surahName} {ayahNumber}
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5 md:py-5">
        {ayahNumber === null ? (
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title={t("tafsir.selectAyah")}
            description={t("tafsir.selectAyahDescription")}
          />
        ) : isLoading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-3.5" style={{ width: `${70 + ((i * 7) % 30)}%` }} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("tafsir.loadFailed")}
            message={t("tafsir.loadFailedMessage")}
            onRetry={() => void refetch()}
          />
        ) : !data ? (
          <EmptyState
            title={t("tafsir.noEntry")}
            description={t("tafsir.noEntryDescription", {
              edition: active?.name ?? t("tafsir.thisTafsir"),
            })}
          />
        ) : (
          // `lang` is set from the edition so the browser picks the right font
          // and hyphenation for Cyrillic Uzbek as readily as for English.
          <>
            <div
              className="prose-reading text-[0.9375rem]"
              lang={active?.language_code}
              data-selectable
            >
              {paragraphs.map((paragraph, index) => (
                <p
                  key={index}
                  ref={(node) => {
                    paragraphRefs.current[index] = node;
                  }}
                  className={cn(
                    "rounded transition-colors duration-700",
                    flashed === index && "bg-gold-soft",
                  )}
                >
                  {paragraph}
                </p>
              ))}
            </div>

            {/* At the end of the commentary rather than beside its heading:
                the honest moment to claim you have read something is when you
                have reached the bottom of it. */}
            <div className="mt-6 flex items-center gap-3 border-t border-border pt-4">
              <Button
                size="sm"
                variant={allRead ? "outline" : "primary"}
                className={cn(allRead && "border-gold/50 bg-gold-soft text-gold-soft-fg")}
                onClick={() => onToggleRead(data.ayah_start, data.ayah_end, !allRead)}
              >
                <GraduationCap className="size-3.5" aria-hidden />
                {allRead ? t("verse.tafsirRead") : t("verse.markTafsirRead")}
              </Button>
              {data.ayah_start !== data.ayah_end ? (
                <span className="text-[0.75rem] text-fg-subtle">
                  {t("tafsir.coversAll", { count: data.ayah_end - data.ayah_start + 1 })}
                </span>
              ) : null}
            </div>

            {/* After the commentary, not above it: the summary is for keeping
                what was read, and it points back into the text rather than
                standing in for it. */}
            {data.content.length >= SUMMARY_MIN_CHARS && surahNumber !== null ? (
              <TafsirSummaryCard
                edition={edition}
                tafsirName={active?.name ?? t("tafsir.thisTafsir")}
                surahName={surahName}
                surahNumber={surahNumber}
                ayahStart={data.ayah_start}
                ayahEnd={data.ayah_end}
                content={data.content}
                onShowQuote={showQuote}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
