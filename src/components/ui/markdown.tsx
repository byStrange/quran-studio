import { Fragment, type Ref } from "react";
import { parseInline, type InlineNode, type MarkdownBlock } from "@/lib/markdown";

export function InlineMarkdown({ text }: { text: string }) {
  return <>{renderInline(parseInline(text))}</>;
}

function renderInline(nodes: InlineNode[]) {
  return nodes.map((node, i) =>
    node.kind === "text" ? (
      <Fragment key={i}>{node.text}</Fragment>
    ) : node.kind === "strong" ? (
      <strong key={i}>{renderInline(node.children)}</strong>
    ) : (
      <em key={i}>{renderInline(node.children)}</em>
    ),
  );
}

/**
 * One block of `parseBlocks` output. Styling for each kind lives under
 * `.prose-reading` in index.css, so the caller only adds what is particular
 * to its own use, like a highlight.
 */
export function MarkdownBlockView({
  block,
  className,
  ref,
}: {
  block: MarkdownBlock;
  className?: string;
  ref?: Ref<HTMLElement>;
}) {
  switch (block.kind) {
    case "heading":
      return (
        <h3 ref={ref as Ref<HTMLHeadingElement>} className={className}>
          <InlineMarkdown text={block.text} />
        </h3>
      );
    case "rule":
      return <hr ref={ref as Ref<HTMLHRElement>} className={className} />;
    case "list":
      return (
        <ul ref={ref as Ref<HTMLUListElement>} className={className}>
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ul>
      );
    case "paragraph":
      return (
        <p ref={ref as Ref<HTMLParagraphElement>} className={className}>
          {block.lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 ? <br /> : null}
              <InlineMarkdown text={line} />
            </Fragment>
          ))}
        </p>
      );
  }
}
