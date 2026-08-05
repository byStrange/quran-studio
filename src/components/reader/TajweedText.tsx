/**
 * Quran text with tajweed rules coloured in.
 *
 * Rules are ranges over the same `arabic_text` that renders when colouring is
 * off (see `scripts/seed/tajweed.ts` for why), so this only ever wraps runs of
 * that string — it never substitutes a different text. Turning tajweed off
 * therefore changes colour and nothing else: no reflow, no glyph shifts.
 *
 * Runs with no rule are emitted as bare text rather than wrapped in a neutral
 * span, which keeps the number of inline boxes down; Arabic shapes across
 * inline boundaries, but there is no reason to create ones nothing needs.
 */
import { Fragment, useMemo } from "react";
import { toTajweedRuns, type TajweedSpan } from "@/lib/tajweed";

export function TajweedText({
  text,
  spans,
  enabled,
}: {
  text: string;
  /** Null for verses imported before tajweed existed; renders plain. */
  spans: readonly TajweedSpan[] | null | undefined;
  enabled: boolean;
}) {
  const runs = useMemo(
    () => (enabled ? toTajweedRuns(text, spans) : null),
    [enabled, spans, text],
  );

  if (runs === null) return <>{text}</>;

  return (
    <>
      {runs.map((run, index) =>
        run.rule === null ? (
          <Fragment key={index}>{run.text}</Fragment>
        ) : (
          <span key={index} data-tajweed={run.rule}>
            {run.text}
          </span>
        ),
      )}
    </>
  );
}
