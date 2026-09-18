/**
 * What the tajweed colours mean — Tarteel Mushaf system.
 *
 * Colours and categories follow the Tarteel Mushaf colour guide:
 * https://support.tarteel.ai/en/articles/14936922-understanding-tajweed-colors-in-the-tarteel-mushaf
 *
 * Colouring is only useful if the reader knows what each colour is asking for,
 * and the rules are worth naming properly rather than reducing to "blue = long"
 * — someone learning tajweed is learning these names too. Collapsed by default
 * so it costs nothing once known, and the open/closed choice is kept locally:
 * it is a per-window habit, like the split position, not a study preference.
 */
import { useState } from "react";
import { ChevronDown, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { TAJWEED_GROUPS, TAJWEED_INFO, rulesByGroup } from "@/lib/tajweed";

const OPEN_KEY = "qs.tajweedLegend";

/** The Tafkhim group has no rule in the quran.com dataset; show it as a
 *  standalone swatch so the legend is still complete. */
const TAFKHIM_SWATCH = {
  cssVar: "var(--tj-tafkhim, #00369E)",
  label: "Tafkhim",
  hint: "Heavy pronunciation — ر with tafkhim and letters of Istiʿlāʾ: خ ص ض غ ط ق ظ.",
};

export function TajweedLegend() {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === "on");

  const toggle = () => {
    setOpen((current) => {
      localStorage.setItem(OPEN_KEY, current ? "off" : "on");
      return !current;
    });
  };

  return (
    <div className="rounded-card border border-border bg-surface">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 px-5 py-3 text-left",
          "text-[0.8125rem] text-fg-muted transition-colors hover:text-fg",
        )}
      >
        <Palette className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        Tajweed colours
        <span className="flex-1" />
        <ChevronDown
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="grid gap-x-8 gap-y-5 border-t border-border px-5 py-4 sm:grid-cols-2">
          {TAJWEED_GROUPS.map((group) => {
            const rules = rulesByGroup(group.id);

            // Tafkhim: no rules in dataset, show a standalone swatch
            if (group.id === "tafkhim") {
              return (
                <section key={group.id}>
                  <h3 className="mb-2 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
                    {group.title}
                  </h3>
                  <ul className="space-y-1.5">
                    <li className="flex items-baseline gap-2.5">
                      <span
                        className="tj-swatch mt-1 size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: TAFKHIM_SWATCH.cssVar }}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="text-[0.8125rem] text-fg">{TAFKHIM_SWATCH.label}</span>
                        <span className="ml-1.5 text-[0.75rem] text-fg-subtle">
                          {TAFKHIM_SWATCH.hint}
                        </span>
                      </span>
                    </li>
                  </ul>
                </section>
              );
            }

            // Skip empty groups
            if (rules.length === 0) return null;

            return (
              <section key={group.id}>
                <h3 className="mb-2 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
                  {group.title}
                </h3>
                <ul className="space-y-1.5">
                  {rules.map((rule) => (
                    <li key={rule} className="flex items-baseline gap-2.5">
                      <span
                        data-tajweed={rule}
                        className="tj-swatch mt-1 size-2.5 shrink-0 rounded-full"
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="text-[0.8125rem] text-fg">{TAJWEED_INFO[rule].label}</span>
                        <span className="ml-1.5 text-[0.75rem] text-fg-subtle">
                          {TAJWEED_INFO[rule].hint}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
