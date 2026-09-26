import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { DARIJA_SECTION_TITLE, DARIJA_UNDERSTANDING_SECTION, withDarijaUnderstanding } from "./assistant-darija-prompt";

/**
 * These tests check the PROMPT the agent receives (that the darija guidance is
 * really in it, and that nothing else changed). They do NOT test how Gemini
 * reasons with it: no model is called here.
 */

const routeSource = readFileSync(new URL("../../app/api/ai/chat/route.ts", import.meta.url), "utf8");

/** The agent's base instruction, as written in the route. */
function baseInstruction(): string {
  const start = routeSource.indexOf("withDarijaUnderstanding(`");
  assert.ok(start >= 0, "the route builds its system instruction with withDarijaUnderstanding()");
  const from = start + "withDarijaUnderstanding(`".length;
  return routeSource.slice(from, routeSource.indexOf("`);", from));
}

const finalPrompt = () => withDarijaUnderstanding(baseInstruction());

test("the agent's final system instruction contains the darija section, after the untouched base prompt", () => {
  const base = baseInstruction();
  const finalText = finalPrompt();
  assert.ok(finalText.startsWith(base), "the base prompt is byte-for-byte the prefix");
  assert.ok(finalText.endsWith(DARIJA_UNDERSTANDING_SECTION));
  assert.ok(finalText.includes(DARIJA_SECTION_TITLE));
  assert.equal(DARIJA_SECTION_TITLE, "COMPRÉHENSION DE LA DARIJA MAROCAINE");
});

test("French keeps working exactly as before: every existing rule and tool instruction is still there", () => {
  const base = baseInstruction();
  for (const rule of [
    "Réponds exclusivement en français",
    "get_product_count",
    "list_out_of_stock_products",
    "list_low_stock_products",
    "get_sales_summary avec period today",
    "period current_month",
    "get_top_selling_products",
    "list_top_customer_receivables",
    "check_stock",
    "multipleMatches à true",
    "build_invoice_preview",
    "create_invoice",
    "cette capacité sera ajoutée dans une prochaine étape",
  ]) {
    assert.ok(base.includes(rule), rule);
    assert.ok(finalPrompt().includes(rule), `final: ${rule}`);
  }
  // nothing was inserted in the middle of the base: the section is only appended
  assert.equal(finalPrompt().indexOf(DARIJA_SECTION_TITLE), base.length + 2);
});

test("the system instruction is wired to BOTH chat calls (normal turn and the function-call-limit fallback)", () => {
  assert.equal((routeSource.match(/^\s+systemInstruction,$/gm) ?? []).length, 2);
  assert.match(routeSource, /const systemInstruction = withDarijaUnderstanding\(`/);
});

// The ten phrases of the acceptance list: the guidance needed to understand each one is in the prompt.
const PHRASES: Array<{ phrase: string; needs: string[] }> = [
  { phrase: "ch7al 3ndi men coca 1L f stock", needs: ["ch7al", "3ndi", "men", "f stock", "Coca 1L"] },
  { phrase: "3tini stock dial coca", needs: ["3tini", "dial", "stock de Coca"] },
  { phrase: "ch7al b3na lyouma", needs: ["ch7al", "b3na", "lyouma", "aujourd'hui"] },
  { phrase: "3tini les ventes dial coca cola lyouma", needs: ["3tini", "dial", "coca cola", "lyouma"] },
  { phrase: "achno howa produit li kaytba3 aktar", needs: ["achno", "howa", "kaytba3 aktar", "le plus vendu"] },
  { phrase: "3tini les produits li salaw", needs: ["3tini", "salaw", "épuisés"] },
  { phrase: "ch7al باقي f stock dial sidi ali", needs: ["ba9i", "باقي", "sidi ali", "écriture arabe"] },
  { phrase: "3tini les clients li 3ndhom créances", needs: ["3ndhom", "créances", "li = qui"] },
  { phrase: "ch7al d les ventes dial had simana", needs: ["had simana", "d = de", "aucune fonction", "sans deviner"] },
  { phrase: "coca stock ?", needs: ["coca stock ?", "Questions courtes ou implicites", "sans exiger une phrase complète"] },
];

for (const { phrase, needs } of PHRASES) {
  test(`understanding of « ${phrase} » is covered by the prompt`, () => {
    const finalText = finalPrompt();
    for (const need of needs) assert.ok(finalText.includes(need), `missing: ${need}`);
  });
}

test("no visible translation: the section forbids showing a translation and keeps answers in French", () => {
  assert.match(DARIJA_UNDERSTANDING_SECTION, /ne la traduis pas/);
  assert.match(DARIJA_UNDERSTANDING_SECTION, /n'affiche jamais de traduction/);
  assert.match(DARIJA_UNDERSTANDING_SECTION, /réponds comme d'habitude, en français/);
});

test("product names are preserved, ambiguity is clarified, and no new capability or date logic is created", () => {
  for (const expected of ["Conserve-les tels que l'utilisateur", "1/2L هوائي", "بومس", "ne les traduis pas, ne les corrige pas, ne les invente pas", "multipleMatches à true", "Parlez-vous du Coca 1L", "ne crée aucune logique de dates parallèle", "sans deviner ni approximer"].map((s) => s.replace("Conserve-les", "conserve-les"))) {
    assert.ok(DARIJA_UNDERSTANDING_SECTION.includes(expected) || DARIJA_UNDERSTANDING_SECTION.toLowerCase().includes(expected.toLowerCase()), expected);
  }
  // the section adds no tool of its own
  assert.equal(/get_[a-z_]+|list_[a-z_]+|search_[a-z_]+|check_stock|create_invoice/.test(DARIJA_UNDERSTANDING_SECTION), false);
});

test("every darija correspondence requested is present", () => {
  for (const token of [
    "ch7al", "chhal", "3ndi", "3and i", "men", "mn", "f stock", "dial", "dyal", "lyouma", "lbare7", "ghdda", "had simana", "had chhar",
    "b3na", "ba9i", "salaw", "kayn", "kaynin", "achno", "chno", "fin", "imta", "3lach", "3tini", "werini", "7seb", "dir lia", "a3tini",
    "chhar li fat", "simana li fatet", "mn nhar",
    "3 correspond à ع", "7 à ح", "9 à ق", "5 à خ", "gh à غ", "ch à ش",
  ]) {
    assert.ok(DARIJA_UNDERSTANDING_SECTION.includes(token), token);
  }
});
