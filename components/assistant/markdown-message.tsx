"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Renders the Markdown of an AI answer (bold, italic, headings, lists, inline
 * code, code blocks, tables, links).
 *
 * Safety: react-markdown does NOT interpret raw HTML (no rehype-raw here), so a
 * "<script>" or "<img onerror=...>" in the answer is shown as plain text, and its
 * default URL filter drops javascript: links. Links open in a new tab with
 * noopener.
 *
 * Look: it inherits the bubble's size/colour (text-sm, leading-6). Blocks are
 * separated by a small gap, single line breaks of a paragraph are kept
 * (whitespace-pre-line), and `unicode-bidi: plaintext` lets an Arabic block
 * start on its own side while Latin, accents and emojis are untouched.
 */

const bidi = "[unicode-bidi:plaintext]";

const components: Components = {
  p: ({ node, className, ...props }) => {
    void node;
    return <p className={cn("whitespace-pre-line", bidi, className)} {...props} />;
  },
  strong: ({ node, ...props }) => {
    void node;
    return <strong className="font-semibold" {...props} />;
  },
  em: ({ node, ...props }) => {
    void node;
    return <em className="italic" {...props} />;
  },
  h1: ({ node, ...props }) => {
    void node;
    return <h3 className={cn("text-base font-semibold", bidi)} {...props} />;
  },
  h2: ({ node, ...props }) => {
    void node;
    return <h3 className={cn("text-base font-semibold", bidi)} {...props} />;
  },
  h3: ({ node, ...props }) => {
    void node;
    return <h3 className={cn("text-base font-semibold", bidi)} {...props} />;
  },
  h4: ({ node, ...props }) => {
    void node;
    return <h4 className={cn("font-semibold", bidi)} {...props} />;
  },
  h5: ({ node, ...props }) => {
    void node;
    return <h4 className={cn("font-semibold", bidi)} {...props} />;
  },
  h6: ({ node, ...props }) => {
    void node;
    return <h4 className={cn("font-semibold", bidi)} {...props} />;
  },
  ul: ({ node, ...props }) => {
    void node;
    return <ul className="list-disc space-y-1 pl-5" {...props} />;
  },
  ol: ({ node, ...props }) => {
    void node;
    return <ol className="list-decimal space-y-1 pl-5" {...props} />;
  },
  li: ({ node, ...props }) => {
    void node;
    return <li className={cn("whitespace-pre-line", bidi)} {...props} />;
  },
  a: ({ node, href, ...props }) => {
    void node;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-emerald-700 underline underline-offset-2"
        {...props}
      />
    );
  },
  blockquote: ({ node, ...props }) => {
    void node;
    return <blockquote className="border-l-2 border-border pl-3 text-muted-foreground" {...props} />;
  },
  hr: ({ node, ...props }) => {
    void node;
    return <hr className="border-border" {...props} />;
  },
  // Inline code and fenced blocks: react-markdown gives blocks a <pre><code>.
  code: ({ node, className, children, ...props }) => {
    void node;
    return (
      <code
        className={cn("rounded bg-black/5 px-1 py-0.5 font-mono text-[0.85em] [unicode-bidi:isolate]", className)}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ node, ...props }) => {
    void node;
    return (
      <pre
        className="overflow-x-auto rounded-xl bg-black/5 p-3 font-mono text-xs leading-5 [&_code]:bg-transparent [&_code]:p-0"
        {...props}
      />
    );
  },
  table: ({ node, ...props }) => {
    void node;
    return (
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-left text-sm" {...props} />
      </div>
    );
  },
  thead: ({ node, ...props }) => {
    void node;
    return <thead className="bg-black/5" {...props} />;
  },
  th: ({ node, ...props }) => {
    void node;
    return <th className="border-b border-border px-3 py-1.5 font-semibold" {...props} />;
  },
  td: ({ node, ...props }) => {
    void node;
    return <td className="border-b border-border/60 px-3 py-1.5 align-top" {...props} />;
  },
};

export function MarkdownMessage({ children }: { children: string }) {
  return (
    <div className="min-w-0 break-words [&>*+*]:mt-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
