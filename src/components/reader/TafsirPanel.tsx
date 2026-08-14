import { useMemo } from "react";
import { BookOpen } from "lucide-react";
import { useTafsirEditions, useTafsirForAyah } from "@/hooks/useQuranData";
import { useUiPrefs, useUpdateProfile } from "@/hooks/useProfile";
import { ayahRangeLabel, toParagraphs } from "@/lib/utils";
import { DEFAULT_TAFSIR_EDITION } from "@/lib/types";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { SelectField } from "@/components/ui/primitives";

export function TafsirPanel({
  surahNumber,
  ayahNumber,
  surahName,
}: {
  surahNumber: number | null;
  ayahNumber: number | null;
  surahName: string;
}) {
  const prefs = useUiPrefs();
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
    return (
      editions.find((e) => e.slug === DEFAULT_TAFSIR_EDITION)?.slug ??
      editions[0]?.slug ??
      DEFAULT_TAFSIR_EDITION
    );
  }, [editions, prefs.tafsirEdition]);

  const active = editions?.find((e) => e.slug === edition);
  const { data, isLoading, isError, refetch } = useTafsirForAyah(surahNumber, ayahNumber, edition);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
            <BookOpen className="size-3.5" aria-hidden />
            Tafsir
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
                covers {data.ayah_end - data.ayah_start + 1} ayahs
              </span>
            ) : null}
          </div>
        ) : ayahNumber ? (
          <div className="mt-1.5 text-sm font-medium text-fg">
            {surahName} {ayahNumber}
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {ayahNumber === null ? (
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title="Select an ayah"
            description="Choose any ayah to read the commentary on it here."
          />
        ) : isLoading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-3.5" style={{ width: `${70 + ((i * 7) % 30)}%` }} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title="Couldn't load the tafsir"
            message="Check your connection and try again."
            onRetry={() => void refetch()}
          />
        ) : !data ? (
          <EmptyState
            title="No commentary for this ayah"
            description={`${
              active?.name ?? "This tafsir"
            } doesn't include a separate entry here. Try a nearby ayah.`}
          />
        ) : (
          // `lang` is set from the edition so the browser picks the right font
          // and hyphenation for Cyrillic Uzbek as readily as for English.
          <div
            className="prose-reading text-[0.9375rem]"
            lang={active?.language_code}
            data-selectable
          >
            {toParagraphs(data.content).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
