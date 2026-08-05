import { BookOpen } from "lucide-react";
import { useTafsirForAyah } from "@/hooks/useQuranData";
import { ayahRangeLabel, toParagraphs } from "@/lib/utils";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";

export function TafsirPanel({
  surahNumber,
  ayahNumber,
  surahName,
}: {
  surahNumber: number | null;
  ayahNumber: number | null;
  surahName: string;
}) {
  const { data, isLoading, isError, refetch } = useTafsirForAyah(surahNumber, ayahNumber);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
          <BookOpen className="size-3.5" aria-hidden />
          Tafsir Ibn Kathir
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
            description="Choose any ayah to read Ibn Kathir's commentary on it here."
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
            description="Ibn Kathir's tafsir doesn't include a separate entry here. Try a nearby ayah."
          />
        ) : (
          <div className="prose-reading text-[0.9375rem]" data-selectable>
            {toParagraphs(data.content).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
