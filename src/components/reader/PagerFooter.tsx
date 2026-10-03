import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Previous / all / next at the bottom of a reader.
 *
 * The three buttons fit in a row only when the column is wide enough, and the
 * column is not the window: with the tafsir pane open beside it, a desktop
 * reader can be as narrow as a phone. So the breakpoint is a container query
 * on the column itself. Below it, previous and next share the first row and
 * the link back to the list takes a row of its own, rather than all three
 * pushing past the edge.
 */
export function PagerFooter({
  previous,
  next,
  allLabel,
  allTo,
  className,
}: {
  previous: { label: string; icon: ReactNode; disabled: boolean; onClick: () => void };
  next: { label: string; icon: ReactNode; disabled: boolean; onClick: () => void };
  allLabel: string;
  allTo: string;
  className?: string;
}) {
  return (
    <div className={cn("@container w-full", className)}>
      <div className="grid grid-cols-2 gap-2 @md:flex @md:items-center @md:justify-between @md:gap-3">
        <Button
          variant="outline"
          className="min-w-0"
          disabled={previous.disabled}
          onClick={previous.onClick}
        >
          {previous.icon}
          <span className="truncate">{previous.label}</span>
        </Button>
        <Button asChild variant="ghost" className="col-span-2 row-start-2 min-w-0">
          <Link to={allTo}>
            <span className="truncate">{allLabel}</span>
          </Link>
        </Button>
        <Button
          variant="primary"
          className="min-w-0"
          disabled={next.disabled}
          onClick={next.onClick}
        >
          <span className="truncate">{next.label}</span>
          {next.icon}
        </Button>
      </div>
    </div>
  );
}
