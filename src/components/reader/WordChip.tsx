import { useState } from "react";
import { Popover } from "radix-ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VerseContext, Word, WordStatus } from "@/lib/types";
import { describeAiError, getWordContext, isTauri } from "@/lib/ai";
import { useSetWordStatus } from "@/hooks/useProgress";
import { useContentLanguage } from "@/hooks/useProfile";
import { wordGloss } from "@/lib/language";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";

const STATUS_STYLES: Record<WordStatus | "none", string> = {
  none: "border-border bg-surface hover:border-border-strong hover:bg-surface-2",
  new: "border-border bg-surface hover:border-border-strong hover:bg-surface-2",
  learning: "border-gold/40 bg-gold-soft/50 hover:border-gold/60",
  learned: "border-accent/40 bg-accent-soft/60 hover:border-accent/60",
};

/**
 * The AI explanation is fetched only once the user opens a word, so opening a
 * ruku never triggers hundreds of generations.
 */
function WordDetail({ word, verse }: { word: Word; verse: VerseContext }) {
  const queryClient = useQueryClient();
  const language = useContentLanguage();
  const [regenerating, setRegenerating] = useState(false);

  // The language is part of the query key as well as the request: switching
  // it must show the other language's explanation, not the cached one for the
  // language that happened to be active when the word was first opened.
  const context = useQuery({
    queryKey: ["word-context", word.id, language],
    staleTime: Infinity,
    retry: false,
    queryFn: () => getWordContext(word, verse, language),
  });

  const regenerate = useMutation({
    mutationFn: () => getWordContext(word, verse, language, { force: true }),
    onMutate: () => setRegenerating(true),
    onSettled: () => setRegenerating(false),
    onSuccess: (data) => queryClient.setQueryData(["word-context", word.id, language], data),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="arabic-sm text-fg" data-selectable>
            {word.arabic}
          </div>
          {word.transliteration ? (
            <div className="mt-0.5 text-[0.8125rem] italic text-fg-subtle">
              {word.transliteration}
            </div>
          ) : null}
        </div>
        <div className="pt-1 text-right text-sm font-medium text-fg">{wordGloss(word, language)}</div>
      </div>

      <div className="border-t border-border pt-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
          <Sparkles className="size-3" aria-hidden />
          In this ayah
        </div>

        {context.isLoading || regenerating ? (
          <div className="space-y-1.5" aria-label="Generating explanation">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-[92%]" />
            <Skeleton className="h-3 w-[70%]" />
          </div>
        ) : context.isError ? (
          <div className="space-y-2">
            <p className="text-[0.8125rem] leading-relaxed text-fg-subtle">
              {isTauri()
                ? describeAiError(context.error)
                : "Word explanations need the desktop backend. Run the app with `pnpm app:dev`."}
            </p>
            {isTauri() ? (
              <Button size="sm" variant="outline" onClick={() => void context.refetch()}>
                <RefreshCw className="size-3.5" aria-hidden />
                Retry
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <p className="prose-reading text-[0.8125rem]" data-selectable>
              {context.data?.explanation}
            </p>
            <button
              onClick={() => regenerate.mutate()}
              className="mt-2 inline-flex items-center gap-1 text-[0.6875rem] text-fg-subtle transition-colors hover:text-fg"
            >
              <RefreshCw className="size-3" aria-hidden />
              Regenerate
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function WordChip({
  word,
  verse,
  status,
  reciting,
}: {
  word: Word;
  verse: VerseContext;
  status: WordStatus | undefined;
  /** This word is the one currently being recited. */
  reciting?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const setStatus = useSetWordStatus();
  const language = useContentLanguage();
  const current = status ?? "none";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className={cn(
            "flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl border px-3 py-2",
            "transition-colors",
            STATUS_STYLES[current],
            // Overrides the learning-status colour while the word is being
            // sung. The status is a long-lived fact the reader can check any
            // time; this lasts under a second and is the only thing making the
            // row followable, so it takes the chip for as long as it holds.
            reciting && "border-accent bg-accent-soft text-accent-soft-fg ring-2 ring-accent/30",
          )}
        >
          <span className="arabic-sm leading-tight text-fg">{word.arabic}</span>
          {word.transliteration ? (
            <span className="text-[0.6875rem] italic leading-tight text-fg-subtle">
              {word.transliteration}
            </span>
          ) : null}
          <span className="text-[0.75rem] leading-tight text-fg-muted">{wordGloss(word, language)}</span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          collisionPadding={16}
          className={cn(
            // Above the focus-mode overlay (z-70), which also shows word chips.
            "z-[80] w-[22rem] rounded-xl border border-border bg-surface p-4",
            "shadow-xl shadow-black/20 animate-rise",
          )}
        >
          <WordDetail word={word} verse={verse} />

          <div className="mt-4 flex gap-2 border-t border-border pt-3">
            <Button
              size="sm"
              variant={current === "learned" ? "primary" : "outline"}
              className="flex-1"
              onClick={() =>
                setStatus.mutate({
                  wordId: word.id,
                  status: current === "learned" ? "learning" : "learned",
                })
              }
            >
              <Check className="size-3.5" aria-hidden />
              {current === "learned" ? "Learned" : "Mark learned"}
            </Button>
            {current !== "learning" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setStatus.mutate({ wordId: word.id, status: "learning" })}
              >
                Learning
              </Button>
            ) : null}
          </div>

          <Popover.Arrow className="fill-[var(--surface)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
