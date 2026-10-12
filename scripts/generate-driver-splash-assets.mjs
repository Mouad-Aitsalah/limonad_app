#!/usr/bin/env node
/**
 * Driver APK launch animation - cuts the layers of the splash illustration.
 *
 *   node scripts/generate-driver-splash-assets.mjs
 *
 * Source: android/app/splash-source/comdis-driver-splash.webp (the illustration
 * supplied for the splash, 1536x1024, kept outside the APK). Output: four
 * lossless WebP layers in android/app/src/main/res/drawable-nodpi/, used by
 * LaunchSplashOverlay.java:
 *
 *   splash_truck.webp        the truck and its ground shadow
 *   splash_driver.webp       the driver, his boxes and his ground shadow
 *   splash_wheel_front.webp  a disc around each axle (hub + white ring + the
 *   splash_wheel_rear.webp   uniform part of the tyre) - rotated while the truck rolls
 *
 * Every layer is a plain CROP of the source: no pixel is redrawn, recoloured or
 * resampled. The geometry below was measured on the source:
 *   - truck and driver are separated by a background gap (x 1136-1145, and
 *     y 833-862 where the driver's shadow reaches back under the truck); the
 *     only shared rectangle (x 1100-1139, y <= 846) belongs to the truck and is
 *     made transparent in the driver layer;
 *   - the tyre is uniform (luminance 37 +/- 1) between radius 66 and 82 around
 *     each axle, so a disc of radius 80 turns without a visible seam.
 * The layer rectangles are mirrored in LaunchSplashOverlay.java (ARTBOARD_* and
 * *_RECT constants) - change both together.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repoRoot, "android", "app", "splash-source", "comdis-driver-splash.webp");
const outDir = path.join(repoRoot, "android", "app", "src", "main", "res", "drawable-nodpi");

const TRUCK = { left: 60, top: 170, width: 1080, height: 677 };
const DRIVER = { left: 1100, top: 250, width: 385, height: 657 };
/** Part of the DRIVER rectangle that belongs to the truck (source coordinates, exclusive bounds). */
const DRIVER_EXCLUDE = { right: 1140, bottom: 847 };

const WHEEL_HALF = 84; // crop = 168 x 168
const WHEEL_SOLID_RADIUS = 80;
const WHEEL_FEATHER = 2;
const WHEELS = {
  splash_wheel_front: { cx: 312.7, cy: 714.9 },
  splash_wheel_rear: { cx: 922.0, cy: 715.5 },
};

const webp = { lossless: true, effort: 6 };

async function rgba(region) {
  return sharp(source).extract(region).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function save(name, data, info) {
  const file = path.join(outDir, `${name}.webp`);
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).webp(webp).toFile(file);
  console.log(`${name}.webp  ${info.width}x${info.height}`);
}

async function main() {
  const meta = await sharp(source).metadata();
  if (meta.width !== 1536 || meta.height !== 1024) {
    throw new Error(`Unexpected source size ${meta.width}x${meta.height} - the measured geometry no longer applies.`);
  }

  const truck = await rgba(TRUCK);
  await save("splash_truck", truck.data, truck.info);

  const driver = await rgba(DRIVER);
  for (let y = 0; y < driver.info.height; y += 1) {
    for (let x = 0; x < driver.info.width; x += 1) {
      if (DRIVER.left + x < DRIVER_EXCLUDE.right && DRIVER.top + y < DRIVER_EXCLUDE.bottom) {
        driver.data[(y * driver.info.width + x) * 4 + 3] = 0;
      }
    }
  }
  await save("splash_driver", driver.data, driver.info);

  for (const [name, { cx, cy }] of Object.entries(WHEELS)) {
    const left = Math.round(cx - WHEEL_HALF);
    const top = Math.round(cy - WHEEL_HALF);
    const size = WHEEL_HALF * 2;
    const disc = await rgba({ left, top, width: size, height: size });
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        // distance from the REAL axle (sub-pixel), measured at the pixel centre
        const d = Math.hypot(left + x + 0.5 - cx, top + y + 0.5 - cy);
        const alpha = d <= WHEEL_SOLID_RADIUS ? 1 : Math.max(0, 1 - (d - WHEEL_SOLID_RADIUS) / WHEEL_FEATHER);
        disc.data[(y * size + x) * 4 + 3] = Math.round(alpha * 255);
      }
    }
    await save(name, disc.data, disc.info);
    console.log(`  axle inside the crop: (${(cx - left).toFixed(1)}, ${(cy - top).toFixed(1)}), crop origin (${left}, ${top})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
