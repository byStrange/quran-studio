/**
 * Meet — turn over each new word to find what it means.
 *
 * The first time a word is seen on its own. Nothing is asked yet: the card
 * shows the word, a tap turns it over to its meaning and says it aloud in the
 * reciter's voice, and the scene is done when every card has been turned. The
 * games that follow ask about exactly these words, so this is where a child
 * who got something wrong will recognise having been told the answer.
 */
import { useState } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/providers/I18nProvider";
import { ContinueButton, SceneLayout, WordArabic, canHear, type SceneProps } from "./kit";

export function MeetScene({ scene, index, audio, tajweed, onDone }: SceneProps<"meet">) {
  const t = useT();
  const [turned, setTurned] = useState<ReadonlySet<number>>(new Set());
  const [speaking, setSpeaking] = useState<number | null>(null);
  const left = scene.words.length - turned.size;

  return (
    <SceneLayout
      title={t("journey.meet.title")}
      hint={t("journey.meet.hint")}
      footer={
        <>
          <span className="text-[0.875rem] tabular-nums text-fg-subtle" aria-live="polite">
            {left > 0 ? t("journey.meet.left", { count: left }) : null}
          </span>
          <ContinueButton onClick={() => onDone(0)} disabled={left > 0} />
        </>
      }
    >
      {/* Right to left, like the ayah the words came out of. */}
      <div dir="rtl" className="flex flex-wrap justify-center gap-3">
        {scene.words.map((ref, order) => {
          const verse = index.verse(ref.verseId);
          const word = index.word(ref);
          if (!verse || !word) return null;
          const open = turned.has(word.id);
          const audible = canHear(audio, verse, word);
          return (
            <button
              key={word.id}
              type="button"
              onClick={() => {
                setTurned((current) => new Set(current).add(word.id));
                if (!audible) return;
                setSpeaking(word.id);
                void audio.playWord(verse.id, word.position).then(() => {
                  setSpeaking((current) => (current === word.id ? null : current));
                });
              }}
              data-state={open ? "selected" : undefined}
              className={cn(
                "journey-tile journey-rise flex h-44 w-36 flex-col items-center justify-center gap-1 px-3 sm:w-40",
                !open && "journey-pulse",
              )}
              style={{ "--i": order } as React.CSSProperties}
              aria-label={word.transliteration ?? undefined}
            >
              <span lang="ar" className="journey-arabic text-fg">
                <WordArabic word={word} tajweed={tajweed} />
              </span>
              {open ? (
                <span className="journey-pop flex flex-col items-center gap-1">
                  <span dir="auto" className="text-[1rem] font-semibold leading-snug">
                    {word.meaning}
                  </span>
                  {word.transliteration ? (
                    <span dir="ltr" className="text-[0.75rem] italic text-fg-subtle">
                      {word.transliteration}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-[1.25rem] font-semibold leading-none text-fg-subtle" aria-hidden>
                  ?
                </span>
              )}
              {audible ? (
                <Volume2
                  className={cn(
                    "mt-0.5 size-4",
                    speaking === word.id ? "text-accent" : "text-fg-subtle",
                    !open && "invisible",
                  )}
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </SceneLayout>
  );
}
