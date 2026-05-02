/**
 * Verifies evenly spaced subsampling to MAX_VISION_FRAMES (no similarity logic).
 * Run: npx tsx scripts/test-frame-subsample.ts
 */

import {
  evenlySpaceFrames,
  MAX_VISION_FRAMES,
} from "../lib/video-frames";

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function main() {
  const a = evenlySpaceFrames([1, 2, 3, 4, 5], 5);
  if (a.join(",") !== "1,2,3,4,5") fail(`short list: got ${a}`);

  const b = evenlySpaceFrames(
    Array.from({ length: 42 }, (_, i) => i),
    MAX_VISION_FRAMES,
  );
  if (b.length !== MAX_VISION_FRAMES) {
    fail(`42→20: expected ${MAX_VISION_FRAMES} frames, got ${b.length}`);
  }
  if (b[0] !== 0 || b[MAX_VISION_FRAMES - 1] !== 41) {
    fail(`42→20: expected endpoints 0 and 41, got ${b[0]}, ${b[MAX_VISION_FRAMES - 1]}`);
  }

  const c = evenlySpaceFrames(["x"], 20);
  if (c.length !== 1 || c[0] !== "x") fail(`single frame`);

  const d = evenlySpaceFrames([10, 20], 20);
  if (d.length !== 2 || d[0] !== 10 || d[1] !== 20) fail(`two frames`);

  console.log(
    `OK  evenlySpaceFrames: 42→${MAX_VISION_FRAMES}, endpoints preserved, short paths OK`,
  );
}

main();
