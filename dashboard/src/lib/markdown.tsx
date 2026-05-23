/**
 * Minimal markdown renderer for CMS body text.
 *
 * The grammar is intentionally tiny so the parser is auditable in a few
 * dozen lines:
 *
 *   **bold**           → <strong>bold</strong>
 *   *italic*           → <em>italic</em>
 *   `code`             → <code>code</code>
 *   [text](href)       → <a href="href">text</a>
 *   ### H3 / ## H2     → <h3>/<h2> (h1 supported too)
 *   - bullet           → <ul><li>bullet</li></ul>
 *   blank line         → paragraph break
 *
 * Every input is HTML-escaped first, so even if an admin pastes a raw
 * `<script>` it renders as text. Links are restricted to http(s) /
 * mailto / relative ("/foo") schemes to block javascript: payloads.
 */

import * as React from "react";

const ESCAPE_HTML: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESCAPE_HTML[ch] ?? ch);
}

function safeUrl(raw: string): string {
  const t = raw.trim();
  // Allow absolute http(s) + mailto, and path-relative URLs starting
  // with a SINGLE "/". The negative lookahead rejects protocol-relative
  // "//example.com" which would silently navigate cross-origin.
  if (/^(?:https?:|mailto:)/i.test(t)) return t;
  if (/^\/(?!\/)/.test(t)) return t;
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(t)) return `mailto:${t}`;
  return "#";
}

/** Inline-level markdown — applied AFTER html escape. */
function renderInline(text: string): string {
  let out = text;
  // [text](href) — must come BEFORE we touch other characters.
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label: string, href: string) =>
      `<a class="text-emerald-700 dark:text-emerald-300 font-medium underline-offset-4 hover:underline" target="_blank" rel="noopener noreferrer" href="${escape(safeUrl(href))}">${label}</a>`,
  );
  // `code` (run first so ** inside ` doesn't get bolded)
  out = out.replace(
    /`([^`]+)`/g,
    (_m, code: string) =>
      `<code class="px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 text-[0.9em]">${code}</code>`,
  );
  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // *italic*  (avoid matching ** by requiring non-* boundaries)
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  return out;
}

/**
 * Block-level parser. Returns a single HTML string. Handles:
 * - Headings (#, ##, ###)
 * - Unordered lists (- item / * item)
 * - Paragraphs separated by blank lines
 */
function renderBlocks(input: string): string {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line
    if (trimmed === "") {
      i++;
      continue;
    }

    // Heading
    const hMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (hMatch) {
      const level = hMatch[1].length;
      const html = renderInline(escape(hMatch[2]));
      const cls =
        level === 1
          ? "text-2xl font-semibold mt-3 mb-2"
          : level === 2
            ? "text-xl font-semibold mt-3 mb-2"
            : "text-lg font-semibold mt-2 mb-1.5";
      out.push(`<h${level} class="${cls}">${html}</h${level}>`);
      i++;
      continue;
    }

    // Unordered list — consume consecutive `- ` / `* ` lines
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*]\s+/, "");
        items.push(`<li>${renderInline(escape(itemText))}</li>`);
        i++;
      }
      out.push(`<ul class="list-disc ml-5 my-2 space-y-1">${items.join("")}</ul>`);
      continue;
    }

    // Paragraph — consume until blank line
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3}\s|[-*]\s)/.test(lines[i].trim())) {
      paraLines.push(lines[i]);
      i++;
    }
    const para = paraLines.join(" ").trim();
    if (para) {
      out.push(`<p class="my-2 leading-relaxed">${renderInline(escape(para))}</p>`);
    }
  }
  return out.join("");
}

/**
 * Render markdown body text. Pass an explicit `inline` prop for short
 * one-line strings (descriptions, eyebrows) where you don't want the
 * paragraph wrapping.
 */
export function Md({
  children,
  inline = false,
  className,
}: {
  children: string;
  inline?: boolean;
  className?: string;
}) {
  if (!children) return null;
  const html = inline ? renderInline(escape(children)) : renderBlocks(children);
  return (
    <span
      className={className}
      // Output is HTML-escaped + restricted to a small grammar, so this
      // is safe even with admin-pasted content.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
