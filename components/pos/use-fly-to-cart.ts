"use client";

import * as React from "react";

import type { PosProduct } from "@/types/pos";

type FlyToCartOptions = {
  product: PosProduct;
  sourceElement: HTMLElement;
  cartElement: HTMLElement | null;
  onComplete: () => void;
};

const FLIGHT_DURATION_MS = 540;

/**
 * A DOM-only visual effect shared by the counter and driver POS. It never
 * participates in adding a cart line: callers update their cart first, then
 * use this hook solely to acknowledge that successful UI action.
 */
export function useFlyToCart() {
  const cleanupsRef = React.useRef(new Set<() => void>());

  React.useEffect(() => {
    const cleanups = cleanupsRef.current;
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
    };
  }, []);

  return React.useCallback((options: FlyToCartOptions) => {
    const { product, sourceElement, cartElement, onComplete } = options;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sourceRect = sourceElement.getBoundingClientRect();
    const cartRect = cartElement?.getBoundingClientRect();

    if (
      reducedMotion ||
      !cartRect ||
      sourceRect.width === 0 ||
      sourceRect.height === 0 ||
      cartRect.width === 0 ||
      cartRect.height === 0
    ) {
      onComplete();
      return;
    }

    const thumbnail = sourceElement.querySelector<HTMLImageElement>("img");
    const flyer = document.createElement("div");
    flyer.className = "pos-fly-to-cart";
    flyer.style.left = `${sourceRect.left + sourceRect.width / 2 - 22}px`;
    flyer.style.top = `${sourceRect.top + sourceRect.height / 2 - 22}px`;
    flyer.style.setProperty("--fly-x", `${cartRect.left + cartRect.width / 2 - sourceRect.left - sourceRect.width / 2}px`);
    flyer.style.setProperty("--fly-y", `${cartRect.top + cartRect.height / 2 - sourceRect.top - sourceRect.height / 2}px`);

    if (thumbnail?.currentSrc || thumbnail?.src) {
      const image = document.createElement("img");
      image.src = thumbnail.currentSrc || thumbnail.src;
      image.alt = "";
      flyer.append(image);
    } else {
      flyer.classList.add("pos-fly-to-cart--placeholder");
      flyer.textContent = product.designation.slice(0, 1).toUpperCase();
    }

    document.body.append(flyer);

    let frame = 0;
    let timeout: number | undefined;
    const cleanup = () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (timeout) window.clearTimeout(timeout);
      flyer.remove();
      cleanupsRef.current.delete(cleanup);
    };
    cleanupsRef.current.add(cleanup);

    frame = window.requestAnimationFrame(() => {
      flyer.classList.add("pos-fly-to-cart--active");
      timeout = window.setTimeout(() => {
        cleanup();
        onComplete();
      }, FLIGHT_DURATION_MS);
    });
  }, []);
}
