import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// react-markdown is ESM-only: loaded at run time from the (CommonJS) test runner.
async function render(markdown: string): Promise<string> {
  const { MarkdownMessage } = (await import("./markdown-message")) as typeof import("./markdown-message");
  return renderToStaticMarkup(React.createElement(MarkdownMessage, null, markdown));
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, "");

const SAMPLE = `Bonjour !

**Produits et stock**
- Nombre total de produits
- Stock faible
- Produits en rupture

**Ventes**
- Chiffre d'affaires
- Nombre de ventes
- Panier moyen

### Exemple

Le produit \`Eau 1/2L\` coûte **72 DH**.`;

test("the sample answer: no visible **, bold titles, headings, lists, inline code", async () => {
  const html = await render(SAMPLE);
  assert.equal(textOf(html).includes("**"), false, "no literal ** left");
  assert.equal(textOf(html).includes("###"), false, "no literal ### left");
  assert.match(html, /<strong[^>]*>Produits et stock<\/strong>/);
  assert.match(html, /<strong[^>]*>Ventes<\/strong>/);
  assert.match(html, /<strong[^>]*>72 DH<\/strong>/);
  assert.match(html, /<h3[^>]*>Exemple<\/h3>/);
  assert.equal((html.match(/<ul[ >]/g) ?? []).length, 2);
  assert.equal((html.match(/<li[ >]/g) ?? []).length, 6);
  assert.match(html, /<code[^>]*>Eau 1\/2L<\/code>/);
  assert.ok(html.includes("Chiffre d&#x27;affaires"));
});

test("line breaks inside a paragraph are kept (pre-line), blocks are separate paragraphs", async () => {
  const html = await render("Ligne 1\nLigne 2\n\nAutre paragraphe");
  assert.match(html, /<p class="[^"]*whitespace-pre-line[^"]*">Ligne 1\nLigne 2<\/p>/);
  assert.match(html, /<p [^>]*>Autre paragraphe<\/p>/);
});

test("italic, ordered lists, fenced code blocks, tables and links", async () => {
  const html = await render(
    [
      "*italique* et **gras**",
      "",
      "1. premier",
      "2. deuxième",
      "",
      "```",
      "SELECT 1;",
      "```",
      "",
      "| Produit | Prix |",
      "| --- | --- |",
      "| Eau 1/2L | 72 DH |",
      "",
      "[COMDIS](https://example.com/page)",
    ].join("\n"),
  );
  assert.match(html, /<em[^>]*>italique<\/em>/);
  assert.match(html, /<ol[^>]*>[\s\S]*<li[^>]*>premier<\/li>[\s\S]*<li[^>]*>deuxième<\/li>/);
  assert.match(html, /<pre[^>]*><code[^>]*>SELECT 1;\n<\/code><\/pre>/);
  assert.match(html, /<table[^>]*>[\s\S]*<th[^>]*>Produit<\/th>[\s\S]*<td[^>]*>Eau 1\/2L<\/td>[\s\S]*<td[^>]*>72 DH<\/td>/);
  assert.match(html, /<a href="https:\/\/example.com\/page" target="_blank" rel="noopener noreferrer"[^>]*>COMDIS<\/a>/);
});

test("accents, Arabic and emojis are kept as they are", async () => {
  const html = await render("**Produits déjà vendus** ✅\n\n- 1/2L هوائي\n- 2L العين 🚚\n\nÉtat : très bon — 100 %");
  const text = textOf(html);
  for (const expected of ["Produits déjà vendus", "✅", "1/2L هوائي", "2L العين", "🚚", "État : très bon — 100 %"]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.match(html, /unicode-bidi:plaintext/);
});

test("dangerous HTML from the answer is NOT interpreted: shown as text, no element, no script, no javascript: link", async () => {
  const html = await render(
    [
      "<script>alert(1)</script>",
      "",
      "<img src=x onerror=alert(1)>",
      "",
      "<a href=\"javascript:alert(1)\">clic</a>",
      "",
      "[piège](javascript:alert(1))",
      "",
      "<iframe src=\"https://evil.example\"></iframe>",
    ].join("\n"),
  );
  assert.equal(/<script/i.test(html), false);
  assert.equal(/<img/i.test(html), false);
  assert.equal(/<iframe/i.test(html), false);
  assert.equal(/href="javascript:/i.test(html), false);
  assert.equal(/onerror=/i.test(html.replace(/&lt;[^]*?&gt;/g, "")), false);
  // it is still readable, as text
  assert.ok(textOf(html).includes("alert(1)"));
});

test("plain text without Markdown is unchanged", async () => {
  const html = await render("Bonjour ! Je suis l’assistant IA de COMDIS.");
  assert.equal(textOf(html), "Bonjour ! Je suis l’assistant IA de COMDIS.");
});
