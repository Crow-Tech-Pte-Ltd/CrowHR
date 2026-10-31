// biome-ignore-all lint/suspicious/noArrayIndexKey: AST nodes have no identity; each render rebuilds the whole tree.
import type * as React from "react";
import type { Block, Inline } from "./api.ts";

/**
 * Renders a letter's parsed tree as React elements: text is always text (never HTML), so a field
 * value can't inject markup. Unfilled merge fields show as highlighted chips.
 */
function inline(nodes: readonly Inline[], key = ""): React.ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case "text":
        return n.text.split("\n").flatMap((part, j) => (j ? [<br key={`${k}br${j}`} />, part] : [part]));
      case "bold":
        return <strong key={k}>{inline(n.children, k)}</strong>;
      case "italic":
        return <em key={k}>{inline(n.children, k)}</em>;
      case "link":
        return (
          <a key={k} href={n.href} target="_blank" rel="noreferrer noopener" className="text-biru-400 underline">
            {inline(n.children, k)}
          </a>
        );
      case "field":
        return (
          <span key={k} className="num break-all rounded-sm bg-kuning-50 px-1 text-2xs text-primary-300">
            {`{{${n.id}}}`}
          </span>
        );
      default:
        return null;
    }
  });
}

export function LetterPreview({ blocks }: { blocks: readonly Block[] }) {
  return (
    <div className="letter-preview space-y-3 text-ui leading-relaxed" data-testid="letter-preview">
      {blocks.map((b, i) => {
        const k = String(i);
        switch (b.t) {
          case "heading":
            return b.level === 1 ? (
              <h3 key={k} className="font-azeret text-base font-semibold">
                {inline(b.children)}
              </h3>
            ) : (
              <h4 key={k} className="pt-1 font-medium">
                {inline(b.children)}
              </h4>
            );
          case "paragraph":
            return <p key={k}>{inline(b.children)}</p>;
          case "list":
            return b.ordered ? (
              <ol key={k} className="list-decimal pl-5">
                {b.items.map((it, j) => (
                  <li key={`${k}-${j}`}>{inline(it)}</li>
                ))}
              </ol>
            ) : (
              <ul key={k} className="list-disc pl-5">
                {b.items.map((it, j) => (
                  <li key={`${k}-${j}`}>{inline(it)}</li>
                ))}
              </ul>
            );
          case "table":
            return (
              <table key={k} className="w-full table-fixed border-collapse break-words text-2xs">
                <thead>
                  <tr>
                    {b.header.map((c, j) => (
                      <th
                        key={`${k}h${j}`}
                        className="border border-ink/15 bg-surface-100 px-2 py-1 text-left font-medium"
                      >
                        {inline(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={`${k}r${j}`}>
                      {r.map((c, m) => (
                        <td key={`${k}r${j}c${m}`} className="border border-ink/15 px-2 py-1 align-top">
                          {inline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "pagebreak":
            return (
              <div key={k} className="flex items-center gap-2 text-2xs text-primary-200">
                <span className="h-px flex-1 border-t border-dashed border-ink/20" />
                New page
                <span className="h-px flex-1 border-t border-dashed border-ink/20" />
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
