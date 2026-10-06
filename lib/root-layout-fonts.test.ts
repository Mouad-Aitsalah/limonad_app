import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

// The root layout once lost its next/font loaders (commit 010b206) while app/globals.css
// kept using their CSS variables: every page then fell back to the browser's default
// serif. These guards keep the two in step.

test("the root layout loads Geist and Geist Mono with next/font (no extra dependency)", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /import \{ Geist, Geist_Mono \} from "next\/font\/google";/);
  assert.match(layout, /const geistSans = Geist\(\{\s*variable: "--font-geist-sans",\s*subsets: \["latin"\],\s*\}\);/);
  assert.match(layout, /const geistMono = Geist_Mono\(\{\s*variable: "--font-geist-mono",\s*subsets: \["latin"\],\s*preload: false,\s*\}\);/);
  // the variables are set on <html>, so body, headings and every utility inherit them
  assert.match(layout, /<html lang="fr" className=\{`\$\{geistSans\.variable\} \$\{geistMono\.variable\} h-full antialiased`\}>/);

  const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.equal(deps.some((name) => name === "geist" || name.startsWith("@fontsource")), false, "next/font is built into Next.js");
});

test("every font variable app/globals.css relies on is defined by the root layout", () => {
  const css = read("app/globals.css");
  const layout = read("app/layout.tsx");
  const used = [...new Set([...css.matchAll(/var\((--font-geist-[a-z]+)\)/g)].map((match) => match[1]))].sort();
  assert.deepEqual(used, ["--font-geist-mono", "--font-geist-sans"]);
  for (const variable of used) assert.ok(layout.includes(`variable: "${variable}"`), variable);

  // body text and headings both resolve to Geist
  assert.match(css, /--font-sans: var\(--font-geist-sans\);/);
  assert.match(css, /--font-heading: var\(--font-sans\);/);
  assert.match(css, /--font-mono: var\(--font-geist-mono\);/);
  assert.match(css, /body \{\s*font-family: var\(--font-geist-sans\), sans-serif;\s*\}/);
});
