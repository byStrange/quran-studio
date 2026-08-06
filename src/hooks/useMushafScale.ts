/**
 * Sizes a mushaf page so its lines span the measure exactly.
 *
 * QCF page fonts bake each printed line's justification into the glyph
 * outlines, so a full line has one natural width and it scales linearly with
 * font size. Fitting a page is therefore a measurement, not a layout problem:
 * measure the widest line once at a reference size to learn how many pixels
 * wide the line is per pixel of font size, then divide the available width by
 * that ratio. Resizing the window re-divides; it never re-measures.
 *
 * The measurement is done off-screen against the real page font, which is why
 * this hook also owns loading it. Ratios are cached for the lifetime of the
 * session, since a page's metrics cannot change.
 */
import { useEffect, useState } from "react";
import { loadPageFont, pageFontFamily, type MushafPageData } from "@/lib/mushaf";

/** Font size the off-screen measurement is taken at. */
const REFERENCE_PX = 100;

/** page → line width in px per px of font size. */
const ratioCache = new Map<number, number>();

interface MushafScale {
  /** Font size in px, or null until the font has loaded and been measured. */
  fontSize: number | null;
  error: Error | null;
}

/** Measures the widest full line of a page at the reference size. */
function measureRatio(page: MushafPageData, family: string): number {
  const probe = document.createElement("div");
  probe.setAttribute("dir", "rtl");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;top:0;left:0;" +
    "white-space:nowrap;width:max-content;" +
    `font-family:"${family}";font-size:${REFERENCE_PX}px;line-height:1;`;

  // Centred lines are short by design and would understate the measure.
  const candidates = page.lines.filter(
    (line) => line.line_type === "ayah" && !line.is_centered && line.glyphs.length > 0,
  );
  const lines = (candidates.length > 0 ? candidates : page.lines).map((line) => {
    const el = document.createElement("div");
    el.textContent = line.glyphs.map((glyph) => glyph.glyph).join("");
    probe.append(el);
    return el;
  });

  document.body.append(probe);
  const widest = Math.max(...lines.map((el) => el.getBoundingClientRect().width), 0);
  probe.remove();

  if (!Number.isFinite(widest) || widest <= 0) {
    throw new Error(`could not measure page ${page.page}`);
  }
  return widest / REFERENCE_PX;
}

export function useMushafScale(
  page: MushafPageData | undefined,
  availableWidth: number | null,
): MushafScale {
  const [ratio, setRatio] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const pageNumber = page?.page ?? null;

  useEffect(() => {
    if (!page || pageNumber === null) return;

    const cached = ratioCache.get(pageNumber);
    if (cached !== undefined) {
      setRatio(cached);
      setError(null);
      return;
    }

    // A new page's metrics are unknown, so drop the previous page's ratio
    // rather than briefly sizing this page by the last one's.
    setRatio(null);
    setError(null);

    let cancelled = false;
    const sample = page.lines.find((line) => line.glyphs.length > 0)?.glyphs[0]?.glyph;
    if (!sample) {
      setError(new Error(`page ${pageNumber} has no glyphs`));
      return;
    }

    loadPageFont(pageNumber, sample)
      .then(() => {
        if (cancelled) return;
        const measured = measureRatio(page, pageFontFamily(pageNumber));
        ratioCache.set(pageNumber, measured);
        setRatio(measured);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      });

    return () => {
      cancelled = true;
    };
  }, [page, pageNumber]);

  const fontSize =
    ratio !== null && availableWidth !== null && availableWidth > 0
      ? availableWidth / ratio
      : null;

  return { fontSize, error };
}

/** Warms the font cache for a page the reader is likely to open next. */
export function prefetchPageFont(page: number | null, sampleGlyph: string | undefined): void {
  if (page === null || !sampleGlyph) return;
  void loadPageFont(page, sampleGlyph).catch(() => {
    // A failed prefetch is not worth reporting; the real load will retry.
  });
}
