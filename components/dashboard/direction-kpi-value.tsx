"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The main figure of a Direction KPI card: as big as the card allows (up to
 * `maxRem`), never wider than the card, and sized right from the FIRST paint.
 *
 * 1. CSS does the sizing, before any JavaScript: the card is a size container and
 *    the font is "card width minus its padding, divided by the width of the text in
 *    em". That text width is computed here from the real advance widths of Geist
 *    Bold (the figure's font, with its -0.03em tracking), character by character -
 *    Geist's digits are proportional ("1" is 0.42 em, "0" is 0.66 em), so an average
 *    per-character ratio would either overflow or waste room.
 * 2. Every value up to the width of a six-digit amount ("123.456 DH" with average
 *    digits) gets that same reference size, so a row of cards reads evenly; only a
 *    genuinely wider value gets its own, smaller size.
 * 3. A guard in the browser still measures the rendered figure and, should it ever
 *    overflow (font not loaded, unexpected characters), shrinks it through --kpi-fit.
 *    With Geist loaded it has nothing to do.
 *
 * Display only: the value string is shown exactly as the server shaped it.
 */

/** Advance widths (em) of Geist Bold with -0.03em tracking, measured in the browser at 1000 px. */
export const GEIST_BOLD_EM: Readonly<Record<string, number>> = {
  "0": 0.663,
  "1": 0.419,
  "2": 0.623,
  "3": 0.62,
  "4": 0.626,
  "5": 0.641,
  "6": 0.597,
  "7": 0.514,
  "8": 0.634,
  "9": 0.601,
  ".": 0.206,
  ",": 0.206,
  "-": 0.387,
  "−": 0.514, // minus sign
  " ": 0.198,
  " ": 0.198, // the no-break space formatDashboardAmount puts before "DH"
  " ": 0.114,
  "%": 0.795,
  D: 0.686,
  H: 0.691,
  // "120 unités" (the forecast card)
  u: 0.577,
  n: 0.581,
  i: 0.251,
  t: 0.415,
  é: 0.575,
  s: 0.54,
};

/** Any other character counts as wider than every glyph above. */
export const KPI_UNKNOWN_CHAR_EM = 0.9;

/** Kerning and sub-pixel rounding: measured within 0.7 % of the real width, 2 % kept. */
export const KPI_VALUE_SAFETY = 1.02;

const AVERAGE_DIGIT_EM =
  ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].reduce((sum, digit) => sum + GEIST_BOLD_EM[digit], 0) / 10;

/** Width of a six-digit amount with average digits, "123.456 DH": the size every typical value shares. */
export const KPI_VALUE_REFERENCE_EM =
  (6 * AVERAGE_DIGIT_EM + GEIST_BOLD_EM["."] + GEIST_BOLD_EM[" "] + GEIST_BOLD_EM.D + GEIST_BOLD_EM.H) *
  KPI_VALUE_SAFETY;

/** Width of `value` in em once rendered (Geist Bold, -0.03em tracking), safety included. */
export function kpiValueEm(value: string): number {
  let width = 0;
  for (const character of value) width += GEIST_BOLD_EM[character] ?? KPI_UNKNOWN_CHAR_EM;
  return width * KPI_VALUE_SAFETY;
}

export function kpiValueFontSize(value: string, maxRem: number): string {
  const textWidthInEm = Math.max(KPI_VALUE_REFERENCE_EM, kpiValueEm(value)).toFixed(3);
  return `calc(min(${maxRem}rem, (100cqw - 2 * var(--kpi-pad, 1.5rem)) / ${textWidthInEm}) * var(--kpi-fit, 1))`;
}

export function DirectionKpiValue({ value, maxRem, className }: { value: string; maxRem: number; className?: string }) {
  const ref = React.useRef<HTMLParagraphElement>(null);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let lastWidth = -1;

    const fit = () => {
      element.style.setProperty("--kpi-fit", "1");
      const available = element.clientWidth;
      const needed = element.scrollWidth;
      if (available > 0 && needed > available) {
        element.style.setProperty("--kpi-fit", String(Math.max(0.5, Math.floor((available / needed) * 100) / 100)));
      }
    };
    // Only a change of WIDTH can change the fit (the height follows the font size).
    const onResize = () => {
      if (element.clientWidth === lastWidth) return;
      lastWidth = element.clientWidth;
      fit();
    };

    onResize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    observer?.observe(element);
    void document.fonts?.ready.then(fit);
    return () => observer?.disconnect();
  }, [value, maxRem]);

  return (
    <p
      ref={ref}
      data-kpi-value
      className={cn("whitespace-nowrap", className)}
      style={{ fontSize: kpiValueFontSize(value, maxRem) }}
    >
      {value}
    </p>
  );
}
