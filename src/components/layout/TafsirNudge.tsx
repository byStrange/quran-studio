import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Check, GraduationCap } from "lucide-react";
import { useContentLanguage, useProfile, useUiPrefs } from "@/hooks/useProfile";
import { useMarkTafsirEntryRead, usePendingTafsir } from "@/hooks/useProgress";
import { verseTranslation } from "@/lib/language";
import { toParagraphs, verseKey } from "@/lib/utils";
import { Modal } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

/**
 * Guards the prompt to one raising per launch.
 *
 * A module-level flag is exactly right here, and a store would be wrong: it
 * dies with the JavaScript context, which is what "a full reopening" means.
 * Coming back from another app leaves the webview alive and the flag set, so
 * the reader is not interrupted mid-session; quitting and reopening starts a
 * fresh context and the next unread tafsir is offered.
 */
let promptedThisLaunch = false;

/**
 * The tafsir prompt on app open.
 *
 * The problem it answers is not that tafsir is hard to reach — it is that
 * nothing ever asks. So the app opens with one question: would you look at the
 * commentary on this ayah you have memorized? It offers a random unread
 * passage from the verses you have memorized.
 *
 * The passage is readable inside the dialog: the reader can take the offer
 * without leaving what they were doing, mark it read, and carry on.
 */
export function TafsirNudge() {
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  const prefs = useUiPrefs();
  const language = useContentLanguage();
  // Held until the profile lands: the edition is a stored preference, so
  // asking before it loads would offer the default edition's text instead of
  // the reader's own.
  const pending = usePendingTafsir(profile ? prefs.tafsirEdition : "");
  const markRead = useMarkTafsirEntryRead();

  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (promptedThisLaunch || !pending.isSuccess) return;
    promptedThisLaunch = true;
    if (pending.data) setOpen(true);
  }, [pending.isSuccess, pending.data]);

  const row = pending.data;
  if (!row) return null;

  const reference = verseKey(row.surah_number, row.ayah_number);
  const range =
    row.ayah_start === row.ayah_end
      ? reference
      : `${row.surah_number}:${row.ayah_start}–${row.ayah_end}`;

  const close = () => setOpen(false);

  const openInReader = () => {
    close();
    navigate(`/read/${row.ruku_number}?ayah=${row.ayah_number}`);
  };

  const markAsRead = () =>
    markRead.mutate({ verseIds: row.verse_ids }, { onSuccess: close });

  return (
    <Modal
      open={open}
      onOpenChange={(next) => setOpen(next)}
      size="lg"
      title="A tafsir you haven't read"
      description={`You've memorized ${reference}. Here's what the commentary says about it.`}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Not now
          </Button>
          <Button variant="outline" onClick={openInReader}>
            <BookOpen className="size-4" aria-hidden />
            Open in reader
          </Button>
          <Button variant="primary" onClick={markAsRead} disabled={markRead.isPending}>
            <Check className="size-4" aria-hidden />
            Mark as read
          </Button>
        </>
      }
    >
      <div className="rounded-xl border border-border bg-surface-2/40 p-4">
        <p className="arabic text-fg" dir="rtl">
          {row.arabic_text}
        </p>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-fg-muted">
          {verseTranslation(
            { translation_en: row.translation_en, translation_ru: row.translation_ru },
            language,
          )}
        </p>
        <div className="mt-3 flex items-center gap-2 text-[0.75rem] text-fg-subtle">
          <GraduationCap className="size-3.5 shrink-0" aria-hidden />
          {row.surah_name} · {range}
        </div>
      </div>

      <div className="mt-4 max-h-[40vh] overflow-y-auto pr-1">
        <div className="prose-reading text-[0.9375rem] text-fg-muted" data-selectable>
          {toParagraphs(row.content).map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      </div>
    </Modal>
  );
}
