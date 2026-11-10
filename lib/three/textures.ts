import * as THREE from "three";
import { hash } from "./math";

// Procedural textures generated on the client at startup. Everything is
// computed locally, so the scene needs no texture downloads.

function valueNoise(size: number, scale: number, seed: number) {
  const g = Math.ceil(size / scale) + 2;
  const grid = new Float32Array(g * g);
  for (let i = 0; i < grid.length; i++) grid[i] = hash(i * 13.37 + seed * 101.1);
  return (x: number, y: number) => {
    const fx = x / scale;
    const fy = y / scale;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const w = (a: number, b: number) => grid[((b % g) + g) % g * g + (((a % g) + g) % g)];
    const a = w(ix, iy);
    const b = w(ix + 1, iy);
    const c = w(ix, iy + 1);
    const d = w(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Normal map from a tileable height function h(x, y) in [0,1]. */
export function normalMapFromHeight(size: number, h: (x: number, y: number) => number, strength = 2): THREE.DataTexture {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) height[y * size + x] = h(x, y);
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function grayTexture(size: number, f: (x: number, y: number) => number, srgb = false): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = Math.max(0, Math.min(255, f(x, y) * 255));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let cache: ReturnType<typeof create> | null = null;

function create() {
  const S = 256;
  // Metallic paint flakes: sparse high-frequency speckle
  const flakes = normalMapFromHeight(S, (x, y) => hash(x * 7.31 + y * 913.7), 0.9);
  flakes.repeat.set(24, 24);

  // Grained plastic (dashboard, cladding, intake parts)
  const n1 = valueNoise(S, 3, 1);
  const n2 = valueNoise(S, 9, 2);
  const grain = normalMapFromHeight(S, (x, y) => n1(x, y) * 0.6 + n2(x, y) * 0.4, 2.2);
  grain.repeat.set(8, 8);

  // Cast-aluminium sand texture (engine block, transmission case)
  const n3 = valueNoise(S, 2, 3);
  const n4 = valueNoise(S, 16, 4);
  const cast = normalMapFromHeight(S, (x, y) => n3(x, y) * 0.7 + n4(x, y) * 0.3, 3.0);
  cast.repeat.set(6, 6);
  const castRough = grayTexture(S, (x, y) => 0.45 + n4(x, y) * 0.3 + n3(x, y) * 0.1);
  castRough.repeat.set(3, 3);

  // Brushed metal streaks
  const streak = valueNoise(S, 1, 5);
  const brushed = grayTexture(S, (x, y) => 0.25 + streak(x * 0.02, y * 3) * 0.25);
  brushed.repeat.set(2, 2);

  // Fabric weave
  const weave = normalMapFromHeight(S, (x, y) => {
    const a = Math.sin((x / S) * Math.PI * 2 * 64) * 0.5 + 0.5;
    const b = Math.sin((y / S) * Math.PI * 2 * 64) * 0.5 + 0.5;
    return (x + y) % 2 === 0 ? a : b;
  }, 1.4);
  weave.repeat.set(6, 6);

  // Tire rubber micro texture
  const n5 = valueNoise(S, 4, 6);
  const rubber = normalMapFromHeight(S, (x, y) => n5(x, y), 1.6);
  rubber.repeat.set(10, 10);

  // Embossed heat-shield dimples
  const dimple = normalMapFromHeight(S, (x, y) => {
    const cx = (x % 16) - 8;
    const cy = (y % 16) - 8;
    return Math.max(0, 1 - Math.hypot(cx, cy) / 7);
  }, 1.5);
  dimple.repeat.set(10, 10);

  // Radiator / intercooler core: fine louvered fins
  const fins = normalMapFromHeight(S, (x, y) => {
    const fin = Math.abs(Math.sin((x / S) * Math.PI * 64));
    const tube = (y % 32) < 6 ? 1 : 0;
    return tube ? 0.9 : fin * 0.6;
  }, 3.5);
  fins.repeat.set(4, 2);

  return { flakes, grain, cast, castRough, brushed, weave, rubber, dimple, fins };
}

export function textures() {
  if (!cache) cache = create();
  return cache;
}

/** Text label on a canvas (battery tops, fuse box lids). */
export function labelTexture(lines: string[], bg = "#141518", fg = "#e5e7eb", accent = "#f59e0b") {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = accent;
  g.fillRect(0, 0, 512, 18);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.font = "bold 64px system-ui, sans-serif";
  g.fillText(lines[0] ?? "", 256, 110);
  g.font = "32px system-ui, sans-serif";
  lines.slice(1).forEach((l, i) => g.fillText(l, 256, 160 + i * 40));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** License plate (demo). */
export function plateTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f4f6f8";
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = "#1f2937";
  g.lineWidth = 10;
  g.strokeRect(10, 10, 492, 236);
  g.fillStyle = "#0b4ea2";
  g.font = "600 34px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText("CALIFORNIA", 256, 62);
  g.fillStyle = "#111827";
  g.font = "bold 118px ui-monospace, monospace";
  g.fillText("CRNKWLL", 256, 196);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
