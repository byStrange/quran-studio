import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useMistakeList, usePendingMarks, useToggleMistake } from "@/hooks/useProgress";
import { useSurahs } from "@/hooks/useQuranData";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LoadingBlock } from "@/components/ui/feedback";
import { Tooltip } from "@/components/ui/primitives";
import { verseKey } from "@/lib/utils";
import { useT } from "@/providers/I18nProvider";

/**
 * The ayahs flagged while someone listened, to come back to.
 *
 * Each row opens the ayah in its ruku and carries the way to clear the flag
 * once it has been put right — the list is only worth keeping if it shrinks.
 */
export function MistakesCard() {
  const t = useT();
  const { data: mistakes, isLoading, isError } = useMistakeList();
  const pending = usePendingMarks();
  const { data: surahs } = useSurahs();
  const toggle = useToggleMistake();
  const surahNames = new Map((surahs ?? []).map((s) => [s.number, s.name_english]));

  return (
    <Card className="mt-6">
      <CardHeader
        title={t("mistakes.title")}
        description={t("mistakes.description")}
      />
      <CardBody>
        {isLoading ? (
          <LoadingBlock />
        ) : !mistakes && isError ? (
          <p className="py-8 text-center text-sm text-fg-subtle">{t("mistakes.loadFailed")}</p>
        ) : !mistakes || mistakes.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-subtle">{t("mistakes.empty")}</p>
        ) : (
          <div className="divide-y divide-border">
            {mistakes.map((verse) => {
              const reference = verseKey(verse.surah_number, verse.ayah_number);
              return (
                <div key={verse.id} className="flex items-center gap-3 py-2.5">
                  <Link
                    to={`/read/${verse.ruku_number}?ayah=${verse.ayah_number}`}
                    className="flex min-w-0 flex-1 items-center gap-4 rounded-lg transition-colors hover:bg-surface-2/50"
                  >
                    <span className="w-28 shrink-0">
                      <span className="block text-sm text-fg">
                        {surahNames.get(verse.surah_number) ?? verse.surah_number}
                      </span>
                      <span className="block text-[0.75rem] tabular-nums text-fg-subtle">
                        {reference}
                      </span>
                    </span>
                    <span className="arabic min-w-0 flex-1 truncate text-fg-muted" dir="rtl">
                      {verse.arabic_text}
                    </span>
                  </Link>
                  <Tooltip content={t("mistakes.clear")}>
                    <button
                      onClick={() => toggle.mutate({ verseId: verse.id, mistake: false })}
                      disabled={pending.mistake.has(verse.id)}
                      aria-label={t("mistakes.clearLabel", { reference })}
                      className="grid disabled:cursor-wait disabled:opacity-60  size-8 shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg touch:size-11"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
