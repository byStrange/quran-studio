import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, ScanText, Trash2 } from "lucide-react";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { SelectField } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/providers/I18nProvider";
import { useGlossContributor } from "@/hooks/useGlossContributor";
import { useSurahs, useAyahRangeWords, type AyahRangeWord } from "@/hooks/useQuranData";
import { extractGlosses, describeAiError, isTauri } from "@/lib/ai";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type Batch = Database["public"]["Tables"]["gloss_uz_batches"]["Row"];

/** base64 without the `data:` prefix, which is what the Ollama API wants. */
interface LoadedImage {
  name: string;
  dataUrl: string;
  base64: string;
}

function readImage(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(",");
      resolve({ name: file.name, dataUrl, base64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl });
    };
    reader.readAsDataURL(file);
  });
}

export function GlossContribute() {
  const t = useT();
  const { isContributor, canReview } = useGlossContributor();
  const [tab, setTab] = useState<"contribute" | "review">("contribute");

  // The tool lives in the desktop backend (the AI runs there) and is gated to
  // the allowlist. Both are real walls — the server refuses either way — so the
  // page says plainly why it is empty rather than pretending to work.
  if (!isTauri()) {
    return (
      <Page title={t("gloss.title")} description={t("gloss.description")}>
        <Card>
          <CardBody>
            <p className="text-sm text-fg-muted">{t("gloss.desktopOnly")}</p>
          </CardBody>
        </Card>
      </Page>
    );
  }
  if (!isContributor) {
    return (
      <Page title={t("gloss.title")} description={t("gloss.description")}>
        <Card>
          <CardBody>
            <p className="text-sm text-fg-muted">{t("gloss.notContributor")}</p>
          </CardBody>
        </Card>
      </Page>
    );
  }

  return (
    <Page title={t("gloss.title")} description={t("gloss.description")}>
      {canReview ? (
        <div className="mb-5 inline-flex rounded-xl border border-border bg-surface p-1">
          <TabButton active={tab === "contribute"} onClick={() => setTab("contribute")}>
            {t("gloss.tabContribute")}
          </TabButton>
          <TabButton active={tab === "review"} onClick={() => setTab("review")}>
            {t("gloss.tabReview")}
          </TabButton>
        </div>
      ) : null}

      {tab === "review" && canReview ? <ReviewTab /> : <ContributeTab />}
    </Page>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-lg px-4 py-1.5 text-[0.8125rem] font-medium transition-colors " +
        (active ? "bg-accent-soft text-accent-soft-fg" : "text-fg-muted hover:text-fg")
      }
    >
      {children}
    </button>
  );
}

// --- contribute -------------------------------------------------------------

function ContributeTab() {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: surahs } = useSurahs();

  const [surah, setSurah] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [range, setRange] = useState<{ surah: number; start: number; end: number } | null>(null);
  const [images, setImages] = useState<LoadedImage[]>([]);
  // Edited glosses, keyed by word id. Seeded from the stored gloss_uz when a
  // range loads, then overwritten by the model's read on extract.
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: words, isFetching: loadingWords } = useAyahRangeWords(range);

  const surahOptions = useMemo(
    () =>
      (surahs ?? []).map((s) => ({ value: String(s.number), label: `${s.number}. ${s.name_english}` })),
    [surahs],
  );

  const selectedSurah = surahs?.find((s) => String(s.number) === surah);

  function loadRange() {
    const s = Number(surah);
    const a = Number(start);
    const b = Number(end);
    if (!s || !a || !b || a > b) {
      toast(t("gloss.rangeInvalid"), "error");
      return;
    }
    if (selectedSurah && b > selectedSurah.ayah_count) {
      toast(t("gloss.rangeInvalid"), "error");
      return;
    }
    setImages([]);
    setDrafts({});
    setRange({ surah: s, start: a, end: b });
  }

  // Seed the draft map from whatever Uzbek glosses already exist, so a range
  // that was partly done before opens showing the current state rather than a
  // blank sheet. Keyed on the range, not on `words`, so a background refetch
  // never wipes edits in progress.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!words || !range) return;
    const key = `${range.surah}:${range.start}:${range.end}`;
    if (seededFor.current === key) return;
    seededFor.current = key;
    const seed: Record<number, string> = {};
    for (const w of words) if (w.gloss_uz) seed[w.id] = w.gloss_uz;
    setDrafts(seed);
  }, [words, range]);

  async function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      const loaded = await Promise.all(Array.from(files).map(readImage));
      setImages((prev) => [...prev, ...loaded]);
    } catch (error) {
      toast(describeAiError(error, t), "error");
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  const extract = useMutation({
    mutationFn: async () => {
      if (!words || words.length === 0) throw new Error(t("gloss.noWords"));
      if (images.length === 0) throw new Error(t("gloss.needImages"));
      return extractGlosses(
        words.map((w) => ({ id: w.id, arabic: w.arabic })),
        images.map((img) => img.base64),
        "uz",
      );
    },
    onSuccess: (results) => {
      let filled = 0;
      setDrafts((prev) => {
        const next = { ...prev };
        for (const r of results) {
          const gloss = r.gloss.trim();
          if (gloss) {
            next[r.id] = gloss;
            filled += 1;
          }
        }
        return next;
      });
      toast(t("gloss.extractDone", { count: filled }), "success");
    },
    onError: (error) => toast(describeAiError(error, t), "error"),
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!range || !words) throw new Error(t("gloss.noWords"));
      const rows = words
        .map((w) => ({ word_id: w.id, gloss: (drafts[w.id] ?? "").trim() }))
        .filter((r) => r.gloss.length > 0);
      if (rows.length === 0) throw new Error(t("gloss.nothingToSubmit"));
      const { error } = await supabase.rpc("submit_gloss_uz", {
        p_surah: range.surah,
        p_start: range.start,
        p_end: range.end,
        p_rows: rows,
      });
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      toast(t("gloss.submitDone", { count }), "success");
      queryClient.invalidateQueries({ queryKey: ["gloss-pending-batches"] });
      setImages([]);
      setDrafts({});
      setRange(null);
      seededFor.current = null;
      setStart("");
      setEnd("");
    },
    onError: (error) => toast(describeAiError(error, t), "error"),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("gloss.rangeTitle")} description={t("gloss.rangeDescription")} />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <label className="block">
              <span className="mb-1 block text-[0.75rem] font-medium text-fg-subtle">
                {t("gloss.rangeSurah")}
              </span>
              <SelectField
                value={surah}
                onValueChange={setSurah}
                options={surahOptions}
                placeholder={t("gloss.rangeSurah")}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[0.75rem] font-medium text-fg-subtle">
                {t("gloss.rangeFrom")}
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[0.75rem] font-medium text-fg-subtle">
                {t("gloss.rangeTo")}
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            <Button variant="secondary" onClick={loadRange} disabled={loadingWords}>
              {loadingWords ? t("gloss.loadingWords") : t("gloss.loadWords")}
            </Button>
          </div>
        </CardBody>
      </Card>

      {range && words && words.length === 0 && !loadingWords ? (
        <Card>
          <CardBody>
            <p className="text-sm text-fg-muted">{t("gloss.noWords")}</p>
          </CardBody>
        </Card>
      ) : null}

      {words && words.length > 0 ? (
        <>
          <Card>
            <CardHeader
              title={t("gloss.uploadTitle")}
              description={t("gloss.uploadHint")}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus className="size-4" aria-hidden />
                  {t("gloss.addImages")}
                </Button>
              }
            />
            <CardBody className="space-y-4">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onPickFiles(e.target.files)}
              />
              {images.length === 0 ? (
                <p className="text-[0.8125rem] text-fg-subtle">{t("gloss.noImages")}</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {images.map((img, i) => (
                    <div key={i} className="group relative">
                      <img
                        src={img.dataUrl}
                        alt={img.name}
                        className="h-28 w-20 rounded-lg border border-border object-cover"
                      />
                      <button
                        type="button"
                        aria-label={t("common.remove")}
                        onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-danger text-white shadow"
                      >
                        <Trash2 className="size-3" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3">
                <Button
                  variant="primary"
                  onClick={() => extract.mutate()}
                  loading={extract.isPending}
                  disabled={images.length === 0 || extract.isPending}
                >
                  <ScanText className="size-4" aria-hidden />
                  {extract.isPending ? t("gloss.extracting") : t("gloss.extract")}
                </Button>
                {extract.isPending ? (
                  <span className="text-[0.8125rem] text-fg-subtle">{t("gloss.extractWait")}</span>
                ) : null}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={t("gloss.reviewDraftTitle")}
              description={t("gloss.reviewDraftHint")}
              action={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => submit.mutate()}
                  loading={submit.isPending}
                  disabled={submit.isPending}
                >
                  {submit.isPending ? t("gloss.submitting") : t("gloss.submit")}
                </Button>
              }
            />
            <CardBody>
              <WordTable
                words={words}
                drafts={drafts}
                onChange={(id, value) => setDrafts((prev) => ({ ...prev, [id]: value }))}
              />
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function WordTable({
  words,
  drafts,
  onChange,
}: {
  words: AyahRangeWord[];
  drafts: Record<number, string>;
  onChange: (id: number, value: string) => void;
}) {
  const t = useT();
  // Grouped by ayah so the contributor can keep their place against the page.
  const groups = useMemo(() => {
    const map = new Map<number, AyahRangeWord[]>();
    for (const w of words) {
      const list = map.get(w.ayah_number) ?? [];
      list.push(w);
      map.set(w.ayah_number, list);
    }
    return [...map.entries()];
  }, [words]);

  return (
    <div className="space-y-5">
      {groups.map(([ayah, items]) => (
        <div key={ayah}>
          <div className="mb-2 text-[0.75rem] font-semibold uppercase tracking-wide text-fg-subtle">
            {t("gloss.ayahLabel", { surah: items[0]!.surah_number, ayah })}
          </div>
          <div className="space-y-1.5">
            {items.map((w) => (
              <div
                key={w.id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]"
              >
                <div className="arabic text-right text-lg text-fg" dir="rtl">
                  {w.arabic}
                </div>
                <div className="hidden truncate text-[0.8125rem] text-fg-subtle sm:block">
                  {w.gloss_en}
                </div>
                <Input
                  dir="rtl"
                  value={drafts[w.id] ?? ""}
                  onChange={(e) => onChange(w.id, e.target.value)}
                  placeholder={t("gloss.uzbekPlaceholder")}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- review -----------------------------------------------------------------

function ReviewTab() {
  const t = useT();

  const { data: batches, isLoading } = useQuery({
    queryKey: ["gloss-pending-batches"],
    queryFn: async (): Promise<Batch[]> => {
      const { data, error } = await supabase
        .from("gloss_uz_batches")
        .select("*")
        .eq("status", "pending")
        .order("submitted_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (!batches || batches.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-fg-muted">{t("gloss.reviewEmpty")}</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {batches.map((batch) => (
        <BatchCard key={batch.id} batch={batch} />
      ))}
    </div>
  );
}

interface SubmissionRow {
  proposed_gloss: string;
  word: { id: number; arabic: string; gloss_en: string | null; gloss_uz: string | null } | null;
}

function BatchCard({ batch }: { batch: Batch }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["gloss-batch-submissions", batch.id],
    enabled: open,
    queryFn: async (): Promise<SubmissionRow[]> => {
      const { data, error } = await supabase
        .from("gloss_uz_submissions")
        .select("proposed_gloss, word:quran_words(id, arabic, gloss_en, gloss_uz)")
        .eq("batch_id", batch.id);
      if (error) throw error;
      return (data ?? []) as SubmissionRow[];
    },
  });

  function afterDecision() {
    queryClient.invalidateQueries({ queryKey: ["gloss-pending-batches"] });
    queryClient.invalidateQueries({ queryKey: ["ayah-range-words"] });
  }

  const approve = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("approve_gloss_batch", { p_batch: batch.id });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      toast(t("gloss.approveDone", { count }), "success");
      afterDecision();
    },
    onError: (error) => toast(describeAiError(error, t), "error"),
  });

  const reject = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("reject_gloss_batch", { p_batch: batch.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast(t("gloss.rejectDone"), "info");
      afterDecision();
    },
    onError: (error) => toast(describeAiError(error, t), "error"),
  });

  const busy = approve.isPending || reject.isPending;

  return (
    <Card>
      <CardHeader
        title={t("gloss.ayahLabel", { surah: batch.surah_number, ayah: batch.ayah_start })}
        description={t("gloss.batchRange", {
          surah: batch.surah_number,
          from: batch.ayah_start,
          to: batch.ayah_end,
        })}
        action={
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={() => approve.mutate()} loading={approve.isPending} disabled={busy}>
              {t("gloss.approve")}
            </Button>
            <Button variant="danger" size="sm" onClick={() => reject.mutate()} loading={reject.isPending} disabled={busy}>
              {t("gloss.reject")}
            </Button>
          </div>
        }
      />
      <CardBody>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[0.8125rem] font-medium text-accent-soft-fg hover:underline"
        >
          {open ? t("gloss.hideWords") : t("gloss.showWords")}
        </button>
        {open ? (
          isLoading ? (
            <div className="py-4">
              <Spinner className="size-4" />
            </div>
          ) : (
            <div className="mt-3 space-y-1.5">
              {(rows ?? []).map((row, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-center gap-3 border-b border-border/60 pb-1.5 last:border-0"
                >
                  <div className="arabic text-right text-lg text-fg" dir="rtl">
                    {row.word?.arabic}
                  </div>
                  <div className="text-sm text-fg" dir="rtl">
                    {row.proposed_gloss}
                    {row.word?.gloss_uz && row.word.gloss_uz !== row.proposed_gloss ? (
                      <span className="ml-2 text-[0.75rem] text-fg-subtle line-through" dir="rtl">
                        {row.word.gloss_uz}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : null}
      </CardBody>
    </Card>
  );
}
