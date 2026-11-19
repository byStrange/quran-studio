import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flag,
  Lightbulb,
  RotateCcw,
  X,
} from "lucide-react";
import {
  useMistakeList,
  useMistakeVerses,
  usePendingMarks,
  useToggleMemorized,
  useToggleMistake,
  type MistakeVerse,
} from "@/hooks/useProgress";
import { useSurahAyahs, useSurahs, type PlainVerse } from "@/hooks/useQuranData";
import { useUiPrefs } from "@/hooks/useProfile";
import { buildPassages, hintWords, type Passage } from "@/lib/mistakes";
import { cn, verseKey } from "@/lib/utils";
import { useT } from "@/providers/I18nProvider";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadingBlock } from "@/components/ui/feedback";
import { ProgressBar, Toggle, Tooltip } from "@/components/ui/primitives";
import { TajweedText } from "@/components/reader/TajweedText";
import { VerseTranslations } from "@/components/reader/VerseTranslations";

// --- practice settings -------------------------------------------------------

/**
 * Who is holding the device. A listener needs to see everything to check the
 * recitation; someone revising alone must not, or they are reading, not
 * reciting.
 */
type Mode = "listener" | "alone";

interface PracticeSettings {
  mode: Mode;
  before: number;
  after: number;
  markMemorized: boolean;
  showTranslation: boolean;
}

const DEFAULT_SETTINGS: PracticeSettings = {
  mode: "listener",
  before: 2,
  after: 1,
  markMemorized: true,
  showTranslation: false,
};

const BEFORE_CHOICES = [1, 2, 3, 5];
const AFTER_CHOICES = [0, 1, 2];
const SETTINGS_KEY = "mistakes-practice";

/** Per-device, like a reading position: a listener and a reviser may share an account. */
function usePracticeSettings() {
  const [settings, setSettings] = useState<PracticeSettings>(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<PracticeSettings>) };
    } catch {
      // Unreadable storage: the defaults will do.
    }
    return DEFAULT_SETTINGS;
  });
  const update = useCallback((patch: Partial<PracticeSettings>) => {
    setSettings((old) => {
      const next = { ...old, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Not remembered, still applied.
      }
      return next;
    });
  }, []);
  return [settings, update] as const;
}

// --- session -----------------------------------------------------------------

type Outcome = "right" | "hinted" | "again" | "skipped";

interface Session {
  queue: Passage<MistakeVerse>[];
  index: number;
  /** Passages already sent round a second time; each gets one retry. */
  retried: Set<string>;
  outcomes: Map<string, Outcome>;
  /** Every flagged ayah the session started with, for the summary. */
  flaggedIds: number[];
}

function startSession(queue: Passage<MistakeVerse>[]): Session {
  return {
    queue,
    index: 0,
    retried: new Set(),
    outcomes: new Map(),
    flaggedIds: queue.flatMap((p) => p.flagged.map((a) => a.id)),
  };
}

// --- page --------------------------------------------------------------------

export function Mistakes() {
  const t = useT();
  const { data: mistakes, isLoading, isError } = useMistakeList();
  const { data: surahs } = useSurahs();
  const [settings, updateSettings] = usePracticeSettings();
  const [session, setSession] = useState<Session | null>(null);

  // A session is a history entry, so the system back button returns to the
  // list instead of leaving the page and losing the place.
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const pushedRef = useRef(false);
  const practising = params.has("practice");
  const start = useCallback(
    (queue: Passage<MistakeVerse>[]) => {
      setSession(startSession(queue));
      if (!practising) {
        pushedRef.current = true;
        setParams({ practice: "1" });
      }
    },
    [practising, setParams],
  );
  const exit = useCallback(() => {
    setSession(null);
    if (pushedRef.current) {
      pushedRef.current = false;
      navigate(-1);
    } else {
      setParams({}, { replace: true });
    }
  }, [navigate, setParams]);
  useEffect(() => {
    if (!practising && session) {
      pushedRef.current = false;
      setSession(null);
    }
    // Arrived with the param but no session (a reload): nothing to resume.
    if (practising && !session) setParams({}, { replace: true });
  }, [practising, session, setParams]);

  const ayahCounts = useMemo(
    () => new Map((surahs ?? []).map((s) => [s.number, s.ayah_count])),
    [surahs],
  );
  const surahNames = useMemo(
    () => new Map((surahs ?? []).map((s) => [s.number, s.name_english])),
    [surahs],
  );

  const passages = useMemo(
    () =>
      buildPassages(mistakes ?? [], ayahCounts, {
        before: settings.before,
        after: settings.after,
      }),
    [mistakes, ayahCounts, settings.before, settings.after],
  );

  const bySurah = useMemo(() => {
    const groups = new Map<number, Passage<MistakeVerse>[]>();
    for (const passage of passages) {
      const list = groups.get(passage.surah) ?? [];
      list.push(passage);
      groups.set(passage.surah, list);
    }
    return [...groups.entries()];
  }, [passages]);

  // Window ends are clamped to each surah's length; built without the counts,
  // every follow-on would be cut off, so nothing is offered until they load.
  const ready = Boolean(surahs) && Boolean(mistakes);

  if (session && practising) {
    return (
      <PracticeSession
        session={session}
        setSession={setSession}
        onExit={exit}
        onRestart={start}
        settings={settings}
        updateSettings={updateSettings}
        surahNames={surahNames}
        ayahCounts={ayahCounts}
      />
    );
  }

  return (
    <Page
      title={t("mistakesPage.title")}
      description={t("mistakesPage.description")}
      action={
        ready && passages.length > 0 ? (
          <Button variant="primary" onClick={() => start(passages)}>
            {t("mistakesPage.practiseAll")}
          </Button>
        ) : undefined
      }
    >
      <SettingsCard settings={settings} updateSettings={updateSettings} />

      <div className="mt-6 space-y-4">
        {isLoading || (mistakes && !surahs) ? (
          <LoadingBlock />
        ) : !mistakes && isError ? (
          <p className="py-8 text-center text-sm text-fg-subtle">{t("mistakes.loadFailed")}</p>
        ) : bySurah.length === 0 ? (
          <Card>
            <CardBody className="py-10 text-center text-sm text-fg-subtle">
              {t("mistakesPage.empty")}
            </CardBody>
          </Card>
        ) : (
          bySurah.map(([surah, list]) => {
            const count = list.reduce((sum, p) => sum + p.flagged.length, 0);
            return (
              <Card key={surah}>
                <CardHeader
                  title={
                    <span>
                      <span className="tabular-nums text-fg-subtle">{surah}.</span>{" "}
                      {surahNames.get(surah) ?? surah}
                    </span>
                  }
                  description={`${t("mistakesPage.countFlagged", { count })} · ${t(
                    "mistakesPage.passages",
                    { count: list.length },
                  )}`}
                  action={
                    <Button size="sm" variant="outline" onClick={() => start(list)}>
                      {t("mistakesPage.practise")}
                    </Button>
                  }
                />
                <CardBody className="divide-y divide-border">
                  {list.map((passage, i) => (
                    <PassageRow
                      key={passage.key}
                      passage={passage}
                      onPractise={() => start(list.slice(i))}
                    />
                  ))}
                </CardBody>
              </Card>
            );
          })
        )}
      </div>
    </Page>
  );
}

function PassageRow({
  passage,
  onPractise,
}: {
  passage: Passage<MistakeVerse>;
  onPractise: () => void;
}) {
  const t = useT();
  const toggle = useToggleMistake();
  const pending = usePendingMarks();
  const first = passage.flagged[0]!;

  return (
    <div className="flex items-center gap-3 py-2.5">
      <button
        onClick={onPractise}
        className="flex min-w-0 flex-1 items-center gap-4 rounded-lg text-left transition-colors hover:bg-surface-2/50"
      >
        <span className="w-28 shrink-0">
          <span className="block text-sm tabular-nums text-fg">
            {passage.flagged.map((a) => a.ayah_number).join(", ")}
          </span>
          <span className="block text-[0.75rem] tabular-nums text-fg-subtle">
            {t("mistakesPage.window", {
              range: `${passage.surah}:${passage.start}–${passage.end}`,
            })}
          </span>
        </span>
        <span className="arabic min-w-0 flex-1 truncate text-fg-muted" dir="rtl">
          {first.arabic_text}
        </span>
      </button>
      <Tooltip content={t("mistakesPage.openInReader")}>
        <Link
          to={`/read/${first.ruku_number}?ayah=${first.ayah_number}`}
          aria-label={t("mistakesPage.openInReader")}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg touch:size-11"
        >
          <BookOpen className="size-4" aria-hidden />
        </Link>
      </Tooltip>
      {passage.flagged.length === 1 ? (
        <Tooltip content={t("mistakes.clear")}>
          <button
            onClick={() => toggle.mutate({ verseId: first.id, mistake: false })}
            disabled={pending.mistake.has(first.id)}
            aria-label={t("mistakes.clearLabel", {
              reference: verseKey(first.surah_number, first.ayah_number),
            })}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-wait disabled:opacity-60 touch:size-11"
          >
            <X className="size-4" aria-hidden />
          </button>
        </Tooltip>
      ) : (
        <span className="size-8 shrink-0 touch:size-11" aria-hidden />
      )}
    </div>
  );
}

// --- settings ----------------------------------------------------------------

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-lg bg-surface-2 p-1">
      {options.map((option) => (
        <button
          key={String(option.value)}
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-[0.75rem] font-medium tabular-nums transition-colors",
            value === option.value ? "bg-surface text-fg shadow-sm" : "text-fg-subtle hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
}) {
  const t = useT();
  return (
    <Segmented
      value={mode}
      onChange={onChange}
      label={t("mistakesPage.modeLabel")}
      options={[
        { value: "listener", label: t("mistakesPage.modeListener") },
        { value: "alone", label: t("mistakesPage.modeAlone") },
      ]}
    />
  );
}

function SettingsCard({
  settings,
  updateSettings,
}: {
  settings: PracticeSettings;
  updateSettings: (patch: Partial<PracticeSettings>) => void;
}) {
  const t = useT();
  return (
    <Card>
      <CardBody className="space-y-4 pt-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div>
            <div className="text-[0.8125rem] font-medium text-fg">
              {t("mistakesPage.modeLabel")}
            </div>
            <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
              {settings.mode === "listener"
                ? t("mistakesPage.modeListenerHint")
                : t("mistakesPage.modeAloneHint")}
            </p>
          </div>
          <ModeSwitch mode={settings.mode} onChange={(mode) => updateSettings({ mode })} />
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div>
            <div className="text-[0.8125rem] font-medium text-fg">{t("mistakesPage.before")}</div>
            <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
              {t("mistakesPage.beforeHint")}
            </p>
          </div>
          <Segmented
            value={settings.before}
            onChange={(before) => updateSettings({ before })}
            label={t("mistakesPage.before")}
            options={BEFORE_CHOICES.map((n) => ({ value: n, label: String(n) }))}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div>
            <div className="text-[0.8125rem] font-medium text-fg">{t("mistakesPage.after")}</div>
            <p className="mt-0.5 text-[0.75rem] text-fg-subtle">{t("mistakesPage.afterHint")}</p>
          </div>
          <Segmented
            value={settings.after}
            onChange={(after) => updateSettings({ after })}
            label={t("mistakesPage.after")}
            options={AFTER_CHOICES.map((n) => ({ value: n, label: String(n) }))}
          />
        </div>

        <div className="flex items-center justify-between gap-6 border-t border-border pt-4">
          <div>
            <div className="text-[0.8125rem] font-medium text-fg">
              {t("mistakesPage.markMemorized")}
            </div>
            <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
              {t("mistakesPage.markMemorizedHint")}
            </p>
          </div>
          <Toggle
            checked={settings.markMemorized}
            onCheckedChange={(markMemorized) => updateSettings({ markMemorized })}
            label={t("mistakesPage.markMemorized")}
          />
        </div>
      </CardBody>
    </Card>
  );
}

// --- practice ----------------------------------------------------------------

function PracticeSession({
  session,
  setSession,
  onExit,
  onRestart,
  settings,
  updateSettings,
  surahNames,
  ayahCounts,
}: {
  session: Session;
  setSession: (session: Session) => void;
  onExit: () => void;
  onRestart: (queue: Passage<MistakeVerse>[]) => void;
  settings: PracticeSettings;
  updateSettings: (patch: Partial<PracticeSettings>) => void;
  surahNames: Map<number, string>;
  ayahCounts: Map<number, number>;
}) {
  const t = useT();
  const passage = session.queue[session.index] ?? null;
  const { data: flags } = useMistakeVerses();
  const toggleMistake = useToggleMistake();
  const toggleMemorized = useToggleMemorized();
  const topRef = useRef<HTMLDivElement>(null);

  // Per-passage reveal state, reset when the passage changes. Not on a mode
  // change: hints taken stay counted, so flipping modes cannot launder them.
  const [revealed, setRevealed] = useState(false);
  const [hints, setHints] = useState<Map<number, number>>(new Map());
  useEffect(() => {
    setRevealed(false);
    setHints(new Map());
    topRef.current?.scrollIntoView({ block: "start" });
  }, [session.index, passage?.key]);

  const hintsUsed = [...hints.values()].reduce((sum, n) => sum + n, 0);

  const advance = useCallback(
    (outcome: Outcome) => {
      if (!passage) return;
      const outcomes = new Map(session.outcomes);
      outcomes.set(passage.key, outcome);
      let queue = session.queue;
      const retried = new Set(session.retried);
      // Anything not recited cleanly comes round once more at the end, while
      // it is still fresh — but only once, so a session always finishes.
      const stillFlagged = passage.flagged.some((a) => flags?.has(a.id) ?? true);
      if ((outcome === "again" || outcome === "hinted") && stillFlagged && !retried.has(passage.key)) {
        retried.add(passage.key);
        queue = [...queue, passage];
      }
      setSession({ ...session, queue, retried, outcomes, index: session.index + 1 });
    },
    [passage, session, setSession, flags],
  );

  const markRight = useCallback(() => {
    if (!passage) return;
    if (hintsUsed > 0) {
      advance("hinted");
      return;
    }
    for (const ayah of passage.flagged) {
      // Every ayah here came off the mistakes list, so with the live set not
      // loaded yet it is still flagged as far as anyone knows.
      if (flags?.has(ayah.id) ?? true) toggleMistake.mutate({ verseId: ayah.id, mistake: false });
      if (settings.markMemorized) toggleMemorized.mutate({ verseId: ayah.id, memorized: true });
    }
    advance("right");
  }, [passage, settings, hintsUsed, flags, toggleMistake, toggleMemorized, advance]);

  const hiddenFrom = passage?.flagged[0]?.ayah_number ?? Infinity;
  const isHidden = (ayah: number) => settings.mode === "alone" && !revealed && ayah >= hiddenFrom;

  const hint = useCallback(
    (verse: PlainVerse) =>
      setHints((old) => {
        const next = new Map(old);
        next.set(verse.id, Math.min((old.get(verse.id) ?? 0) + 1, hintWords(verse.arabic_text).length));
        return next;
      }),
    [],
  );

  const { data: ayahs, isLoading, isError, refetch } = useSurahAyahs(passage?.surah ?? null);
  const shown = useMemo(
    () =>
      passage
        ? (ayahs ?? []).filter((a) => a.ayah_number >= passage.start && a.ayah_number <= passage.end)
        : [],
    [ayahs, passage],
  );
  // Grading needs the text in view — loaded, and in the alone mode revealed —
  // or a verdict would be given on a recitation nobody could check.
  const canGrade = shown.length > 0 && (settings.mode === "listener" || revealed);
  const firstHidden = shown.find(
    (a) => isHidden(a.ayah_number) && (hints.get(a.id) ?? 0) < hintWords(a.arabic_text).length,
  );

  // Keyboard, for a desktop on the table between the two of you.
  useEffect(() => {
    if (!passage) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const key = event.key.toLowerCase();
      // A focused control keeps its own Enter, Space and arrows.
      if (
        ["enter", " ", "arrowleft", "arrowright"].includes(key) &&
        target?.closest("button, a, [role=radio], [role=switch]")
      ) {
        return;
      }
      if (key === "enter" && canGrade) markRight();
      else if (key === "a" && canGrade) advance("again");
      else if (key === "h" && settings.mode === "alone" && !revealed && firstHidden) hint(firstHidden);
      else if (key === " " && settings.mode === "alone" && !revealed) setRevealed(true);
      else if (key === "arrowright") advance("skipped");
      else if (key === "arrowleft" && session.index > 0)
        setSession({ ...session, index: session.index - 1 });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [passage, canGrade, markRight, advance, settings.mode, revealed, firstHidden, hint, session, setSession]);

  if (!passage) {
    return (
      <SessionSummary
        session={session}
        flags={flags}
        onAgain={onRestart}
        onExit={onExit}
        settings={settings}
        ayahCounts={ayahCounts}
      />
    );
  }

  const total = session.queue.length;
  const isRetry = session.queue.indexOf(passage) !== session.index;

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1.5rem))] md:px-8 md:py-9">
      <div ref={topRef} className="scroll-mt-6" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onExit}>
          <ArrowLeft className="size-4" aria-hidden />
          {t("mistakesPage.back")}
        </Button>
        <ModeSwitch mode={settings.mode} onChange={(mode) => updateSettings({ mode })} />
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-fg">
            {surahNames.get(passage.surah) ?? passage.surah}{" "}
            <span className="font-normal tabular-nums text-fg-subtle">
              {passage.surah}:{passage.start}–{passage.end}
            </span>
          </h1>
          <span className="shrink-0 text-[0.75rem] tabular-nums text-fg-subtle">
            {isRetry ? `${t("mistakesPage.retryBadge")} · ` : ""}
            {t("mistakesPage.progress", { current: session.index + 1, total })}
          </span>
        </div>
        <ProgressBar value={(session.index / total) * 100} className="mt-2 h-1.5" />
      </div>

      <div className="mt-4 flex justify-end">
        <label className="flex items-center gap-2 text-[0.75rem] text-fg-subtle">
          {t("mistakesPage.showTranslation")}
          <Toggle
            checked={settings.showTranslation}
            onCheckedChange={(showTranslation) => updateSettings({ showTranslation })}
            label={t("mistakesPage.showTranslation")}
          />
        </label>
      </div>

      <Card className="mt-3 overflow-hidden">
        {isLoading ? (
          <LoadingBlock />
        ) : isError && shown.length === 0 ? (
          <div className="space-y-3 px-5 py-8 text-center">
            <p className="text-sm text-fg-subtle">{t("mistakesPage.ayahsFailed")}</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : (
          shown.map((verse) => (
            <PracticeAyah
              key={verse.id}
              verse={verse}
              passage={passage}
              mode={settings.mode}
              hidden={isHidden(verse.ayah_number)}
              hintCount={hints.get(verse.id) ?? 0}
              onHint={() => hint(verse)}
              flagged={flags?.has(verse.id) ?? false}
              onToggleFlag={() => {
                // Until the set has loaded, the flag's direction is unknown.
                if (!flags) return;
                const clearing = flags.has(verse.id);
                toggleMistake.mutate({ verseId: verse.id, mistake: !clearing });
                // Clearing one ayah by hand is the same verdict as the main
                // button gives the whole passage.
                if (clearing && settings.markMemorized) {
                  toggleMemorized.mutate({ verseId: verse.id, memorized: true });
                }
              }}
              showTranslation={settings.showTranslation}
            />
          ))
        )}
        {passage.end === ayahCounts.get(passage.surah) ? (
          <div className="border-t border-border px-5 py-3 text-center text-[0.75rem] text-fg-subtle">
            {t("mistakesPage.endOfSurah")}
          </div>
        ) : null}
      </Card>

      <div className="mt-5 space-y-3">
        {settings.mode === "alone" && !revealed ? (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={shown.length === 0}
            onClick={() => setRevealed(true)}
          >
            <Eye className="size-4" aria-hidden />
            {t("mistakesPage.reveal")}
          </Button>
        ) : (
          <>
            {hintsUsed > 0 ? (
              <p className="text-center text-[0.75rem] text-fg-subtle">
                {session.retried.has(passage.key)
                  ? t("mistakesPage.hintedNoteFinal", { count: hintsUsed })
                  : t("mistakesPage.hintedNote", { count: hintsUsed })}
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                size="lg"
                disabled={!canGrade}
                onClick={() => advance("again")}
              >
                <RotateCcw className="size-4" aria-hidden />
                {t("mistakesPage.needsWork")}
              </Button>
              <Button variant="primary" size="lg" disabled={!canGrade} onClick={markRight}>
                <CheckCircle2 className="size-4" aria-hidden />
                {hintsUsed > 0
                  ? t("mistakesPage.gotItRightHinted")
                  : t("mistakesPage.gotItRight")}
              </Button>
            </div>
          </>
        )}

        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={session.index === 0}
            onClick={() => setSession({ ...session, index: session.index - 1 })}
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t("mistakesPage.prev")}
          </Button>
          <span className="hidden text-[0.6875rem] text-fg-subtle can-hover:inline">
            {settings.mode === "alone" ? t("mistakesPage.keysAlone") : t("mistakesPage.keysListener")}
          </span>
          <Button variant="ghost" size="sm" onClick={() => advance("skipped")}>
            {t("mistakesPage.next")}
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PracticeAyah({
  verse,
  passage,
  mode,
  hidden,
  hintCount,
  onHint,
  flagged,
  onToggleFlag,
  showTranslation,
}: {
  verse: PlainVerse;
  passage: Passage<MistakeVerse>;
  mode: Mode;
  hidden: boolean;
  hintCount: number;
  onHint: () => void;
  flagged: boolean;
  onToggleFlag: () => void;
  showTranslation: boolean;
}) {
  const t = useT();
  const prefs = useUiPrefs();
  const pending = usePendingMarks();
  const wasFlagged = passage.flagged.some((a) => a.id === verse.id);
  const firstFlagged = passage.flagged[0]!.ayah_number;
  const isLeadIn = verse.ayah_number < firstFlagged;
  const reference = verseKey(verse.surah_number, verse.ayah_number);
  const words = useMemo(() => (hidden ? hintWords(verse.arabic_text) : []), [hidden, verse.arabic_text]);

  return (
    <div
      className={cn(
        "relative border-b border-border px-5 py-5 last:border-b-0",
        isLeadIn && "bg-surface-2/40",
      )}
    >
      {wasFlagged ? (
        <span
          className={cn(
            "absolute inset-y-0 left-0 w-[3px]",
            flagged ? "bg-danger" : "bg-accent",
          )}
          aria-hidden
        />
      ) : null}

      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-surface-2 px-1.5 text-[0.75rem] font-semibold tabular-nums text-fg-muted">
          {verse.ayah_number}
        </span>
        {verse.ayah_number === firstFlagged && passage.start < firstFlagged ? (
          <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-fg-subtle">
            {t("mistakesPage.recite")}
          </span>
        ) : isLeadIn && verse.ayah_number === passage.start ? (
          <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-fg-subtle">
            {mode === "listener" ? t("mistakesPage.leadInListener") : t("mistakesPage.leadInAlone")}
          </span>
        ) : null}
        <span className="flex-1" />
        {wasFlagged ? (
          <Tooltip
            content={
              flagged
                ? t("mistakesPage.clearFlag", { reference })
                : t("mistakesPage.raiseFlag", { reference })
            }
          >
            <button
              onClick={onToggleFlag}
              disabled={pending.mistake.has(verse.id)}
              aria-pressed={flagged}
              aria-label={
                flagged
                  ? t("mistakesPage.clearFlag", { reference })
                  : t("mistakesPage.raiseFlag", { reference })
              }
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[0.75rem] font-medium transition-colors disabled:cursor-wait disabled:opacity-60",
                flagged
                  ? "bg-danger-soft text-danger-soft-fg hover:opacity-90"
                  : "bg-accent-soft/60 text-accent-soft-fg hover:bg-accent-soft",
              )}
            >
              {flagged ? (
                <Flag className="size-3.5" aria-hidden />
              ) : (
                <CheckCircle2 className="size-3.5" aria-hidden />
              )}
              {flagged ? t("mistakesPage.flagged") : t("mistakesPage.cleared")}
            </button>
          </Tooltip>
        ) : null}
      </div>

      {hidden ? (
        <div className="mt-4">
          <p className="arabic min-h-[3.5rem] text-fg" dir="rtl">
            {words.slice(0, hintCount).join(" ")}
            {hintCount < words.length ? (
              <span className="text-fg-subtle/60"> {hintCount > 0 ? "…" : ""}</span>
            ) : null}
          </p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[0.75rem] text-fg-subtle">
              {hintCount === 0
                ? t("mistakesPage.hiddenAyah")
                : t("mistakesPage.hintsUsed", { count: hintCount })}
            </span>
            {hintCount < words.length ? (
              <Button size="sm" variant="ghost" onClick={onHint}>
                <Lightbulb className="size-3.5" aria-hidden />
                {t("mistakesPage.hint")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <p className={cn("arabic mt-4", isLeadIn ? "text-fg-muted" : "text-fg")} dir="rtl">
            <TajweedText text={verse.arabic_text} spans={verse.tajweed} enabled={prefs.tajweed} />
          </p>
          {showTranslation ? (
            <VerseTranslations
              className="mt-3"
              verse={verse}
              translations={prefs.translations}
              textClassName="text-[0.875rem]"
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function SessionSummary({
  session,
  flags,
  onAgain,
  onExit,
  settings,
  ayahCounts,
}: {
  session: Session;
  flags: Set<number> | undefined;
  onAgain: (queue: Passage<MistakeVerse>[]) => void;
  onExit: () => void;
  settings: PracticeSettings;
  ayahCounts: Map<number, number>;
}) {
  const t = useT();
  const total = new Set(session.flaggedIds).size;
  const remaining = useMemo(() => {
    const seen = new Set<number>();
    const left: MistakeVerse[] = [];
    for (const passage of session.queue) {
      for (const ayah of passage.flagged) {
        if (seen.has(ayah.id)) continue;
        seen.add(ayah.id);
        if (flags?.has(ayah.id) ?? true) left.push(ayah);
      }
    }
    return left;
  }, [session.queue, flags]);
  const cleared = total - remaining.length;

  return (
    <Page title={t("mistakesPage.doneTitle")}>
      <Card>
        <CardBody className="space-y-5 pt-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-accent" aria-hidden />
          <p className="text-base text-fg">
            {t("mistakesPage.doneSummary", { cleared, total })}
          </p>
          <p className="text-sm text-fg-subtle">
            {remaining.length === 0
              ? t("mistakesPage.doneAllClear")
              : t("mistakesPage.doneRemaining", { count: remaining.length })}
          </p>
          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            {remaining.length > 0 ? (
              <Button
                variant="primary"
                onClick={() =>
                  onAgain(
                    buildPassages(remaining, ayahCounts, {
                      before: settings.before,
                      after: settings.after,
                    }),
                  )
                }
              >
                <RotateCcw className="size-4" aria-hidden />
                {t("mistakesPage.practiseRemaining")}
              </Button>
            ) : null}
            <Button variant="outline" onClick={onExit}>
              {t("mistakesPage.back")}
            </Button>
          </div>
        </CardBody>
      </Card>
    </Page>
  );
}
