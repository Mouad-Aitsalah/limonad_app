import type { Align, RasterCellsRenderer, RasterImage, RasterRenderer } from "@/lib/escpos-receipt";

/**
 * Browser/WebView renderer for the few lines a thermal printer cannot print as
 * text (Arabic...): draws the text on a canvas and packs it as a 1-bit image.
 * Only used for such lines - the rest of the ticket stays native ESC/POS text.
 * Returns null when no canvas is available (the encoder then prints a readable
 * placeholder instead of garbage).
 */

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

/** Packs RGBA pixels into a 1bpp image (black when dark enough and opaque). */
export function rgbaToRasterImage(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): RasterImage {
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3] / 255;
      // composite on white, then a luminance threshold
      const luminance = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * alpha + 255 * (1 - alpha);
      if (luminance < 140) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, data };
}

export const canvasRasterRenderer: RasterRenderer = (text, { widthDots, fontPx, bold, align }) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  const rtl = RTL.test(text);
  const font = `${bold ? "bold " : ""}${fontPx}px "Noto Sans Arabic", "Segoe UI", Arial, sans-serif`;
  context.font = font;
  const measured = Math.ceil(context.measureText(text).width);
  const height = Math.ceil(fontPx * 1.5);
  const width = widthDots;
  canvas.width = width;
  canvas.height = height;

  // Resizing a canvas resets its state.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#000000";
  context.font = font;
  context.textBaseline = "middle";
  context.direction = rtl ? "rtl" : "ltr";

  const effectiveAlign: Align = align;
  let x: number;
  if (effectiveAlign === "center") {
    context.textAlign = "center";
    x = width / 2;
  } else if (effectiveAlign === "right") {
    context.textAlign = "right";
    x = width;
  } else {
    context.textAlign = "left";
    x = 0;
  }
  // Text wider than the paper is squeezed horizontally instead of being cut.
  if (measured > width) {
    context.save();
    context.scale(width / measured, 1);
    context.fillText(text, x * (measured / width), height / 2);
    context.restore();
  } else {
    context.fillText(text, x, height / 2);
  }
  const pixels = context.getImageData(0, 0, width, height).data;
  return rgbaToRasterImage(pixels, width, height);
};

/**
 * One table row drawn as a single image: every cell at its own x (left edge) or
 * right edge, so the row keeps the columns of the text rows. Used only when a
 * product name cannot be printed as text.
 */
export const canvasRasterCellsRenderer: RasterCellsRenderer = (cells, { widthDots, fontPx }) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const height = Math.ceil(fontPx * 1.5);
  canvas.width = widthDots;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, widthDots, height);
  context.fillStyle = "#000000";
  context.textBaseline = "middle";
  const font = `${fontPx}px "Noto Sans Arabic", "Segoe UI", Arial, sans-serif`;
  for (const cell of cells) {
    context.font = font;
    context.direction = RTL.test(cell.text) ? "rtl" : "ltr";
    context.textAlign = cell.align === "right" ? "right" : "left";
    // fillText squeezes the text into maxWidth instead of overflowing into the next column
    if (cell.maxWidth && cell.maxWidth > 0) context.fillText(cell.text, cell.at, height / 2, cell.maxWidth);
    else context.fillText(cell.text, cell.at, height / 2);
  }
  return rgbaToRasterImage(context.getImageData(0, 0, widthDots, height).data, widthDots, height);
};
