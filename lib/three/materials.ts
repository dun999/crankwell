import * as THREE from "three";
import { labelTexture, plateTexture, textures } from "./textures";

export type MatKey =
  | "paint"
  | "paintInner"
  | "cladding"
  | "eCoat"
  | "glass"
  | "glassDark"
  | "chrome"
  | "blackGloss"
  | "alu"
  | "aluCast"
  | "aluBrushed"
  | "wheelFace"
  | "wheelDark"
  | "steel"
  | "steelDark"
  | "castIron"
  | "castDark"
  | "rotor"
  | "rubber"
  | "tire"
  | "plastic"
  | "plasticGray"
  | "plasticTextured"
  | "engineCover"
  | "lensClear"
  | "lensRed"
  | "ledWhite"
  | "ledRed"
  | "ledAmber"
  | "lampHousing"
  | "caliper"
  | "copper"
  | "gold"
  | "fluidBrake"
  | "fluidCoolant"
  | "translucent"
  | "fabric"
  | "leather"
  | "dash"
  | "carpet"
  | "heatShield"
  | "exhaust"
  | "battery"
  | "batteryLabel"
  | "ceramic"
  | "radiatorCore"
  | "plate"
  | "redPlastic"
  | "bluePlastic"
  | "yellow";

export type MaterialSet = Record<MatKey, THREE.Material>;

const P = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);
const S = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);

export function createMaterials(opts: { paint: string; coolant: string; wheelDark: boolean }): MaterialSet {
  const tx = textures();
  const m: MaterialSet = {
    paint: P({
      color: opts.paint,
      metalness: 0.62,
      roughness: 0.34,
      clearcoat: 1,
      clearcoatRoughness: 0.035,
      normalMap: tx.flakes,
      normalScale: new THREE.Vector2(0.12, 0.12),
      envMapIntensity: 1.15,
    }),
    paintInner: S({ color: "#33363b", roughness: 0.6, metalness: 0.1, side: THREE.BackSide }),
    cladding: S({ color: "#17181a", roughness: 0.82, metalness: 0, normalMap: tx.grain, normalScale: new THREE.Vector2(0.6, 0.6) }),
    eCoat: S({ color: "#2b2e33", roughness: 0.62, metalness: 0.15, side: THREE.DoubleSide }),
    glass: P({
      color: "#0b1117",
      metalness: 0,
      roughness: 0.02,
      transparent: true,
      opacity: 0.5,
      ior: 1.52,
      reflectivity: 0.55,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    glassDark: P({
      color: "#05080b",
      metalness: 0,
      roughness: 0.03,
      transparent: true,
      opacity: 0.72,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    chrome: P({ color: "#f0f2f5", metalness: 1, roughness: 0.06, envMapIntensity: 1.3 }),
    blackGloss: P({ color: "#08090a", metalness: 0.1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 }),
    alu: S({ color: "#c7cbd1", metalness: 1, roughness: 0.32 }),
    aluCast: S({
      color: "#a7abb2",
      metalness: 0.85,
      roughness: 0.55,
      roughnessMap: tx.castRough,
      normalMap: tx.cast,
      normalScale: new THREE.Vector2(0.35, 0.35),
    }),
    aluBrushed: P({ color: "#cfd3d8", metalness: 1, roughness: 0.25, roughnessMap: tx.brushed, anisotropy: 0.6 }),
    wheelFace: P({ color: "#d3d6db", metalness: 1, roughness: 0.18, clearcoat: 0.8, clearcoatRoughness: 0.08 }),
    wheelDark: P({ color: "#3b4047", metalness: 0.9, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.08 }),
    steel: S({ color: "#9aa0a7", metalness: 0.9, roughness: 0.38 }),
    steelDark: S({ color: "#3c3f44", metalness: 0.75, roughness: 0.5 }),
    castIron: S({ color: "#5b5e63", metalness: 0.8, roughness: 0.62, normalMap: tx.cast, normalScale: new THREE.Vector2(0.5, 0.5) }),
    castDark: S({ color: "#3d3a38", metalness: 0.7, roughness: 0.72, normalMap: tx.cast, normalScale: new THREE.Vector2(0.6, 0.6) }),
    rotor: P({ color: "#9a9ca2", metalness: 1, roughness: 0.28, roughnessMap: tx.brushed, anisotropy: 0.5, anisotropyRotation: Math.PI / 2 }),
    rubber: S({ color: "#141414", roughness: 0.88, metalness: 0 }),
    tire: S({ color: "#19191a", roughness: 0.86, metalness: 0, normalMap: tx.rubber, normalScale: new THREE.Vector2(0.5, 0.5) }),
    plastic: S({ color: "#1c1d20", roughness: 0.5, metalness: 0.05 }),
    plasticGray: S({ color: "#5b6068", roughness: 0.55, metalness: 0.05 }),
    plasticTextured: S({ color: "#151618", roughness: 0.85, metalness: 0, normalMap: tx.grain, normalScale: new THREE.Vector2(0.7, 0.7) }),
    engineCover: P({ color: "#1d1f23", roughness: 0.42, metalness: 0.25, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
    lensClear: P({
      color: "#ffffff",
      metalness: 0,
      roughness: 0.02,
      transmission: 1,
      thickness: 0.006,
      ior: 1.49,
      transparent: true,
      opacity: 1,
      envMapIntensity: 1.5,
      side: THREE.DoubleSide,
    }),
    lensRed: P({
      color: "#7d0a12",
      emissive: "#ff1f2d",
      emissiveIntensity: 0.25,
      metalness: 0,
      roughness: 0.08,
      clearcoat: 1,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    }),
    ledWhite: S({ color: "#ffffff", emissive: "#e9f3ff", emissiveIntensity: 2.4, roughness: 0.3 }),
    ledRed: S({ color: "#ff2a2a", emissive: "#ff1a1a", emissiveIntensity: 1.6, roughness: 0.3 }),
    ledAmber: S({ color: "#ffb020", emissive: "#ff9a00", emissiveIntensity: 0.7, roughness: 0.3 }),
    lampHousing: P({ color: "#2b2f36", metalness: 0.95, roughness: 0.16 }),
    caliper: P({ color: "#2d3035", metalness: 0.55, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
    copper: S({ color: "#b87140", metalness: 1, roughness: 0.32 }),
    gold: S({ color: "#c9a14a", metalness: 1, roughness: 0.3 }),
    fluidBrake: P({ color: "#d7a03a", roughness: 0.08, metalness: 0, transparent: true, opacity: 0.78 }),
    fluidCoolant: P({ color: opts.coolant, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.8 }),
    translucent: P({ color: "#f3f1ea", roughness: 0.45, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
    fabric: S({ color: "#2a2c30", roughness: 0.96, metalness: 0, normalMap: tx.weave, normalScale: new THREE.Vector2(0.5, 0.5) }),
    leather: P({ color: "#26221f", roughness: 0.55, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color("#3a332e"), normalMap: tx.grain, normalScale: new THREE.Vector2(0.25, 0.25) }),
    dash: S({ color: "#1b1d20", roughness: 0.72, metalness: 0, normalMap: tx.grain, normalScale: new THREE.Vector2(0.5, 0.5) }),
    carpet: S({ color: "#17181a", roughness: 1, metalness: 0 }),
    heatShield: S({ color: "#b9bcc1", metalness: 0.9, roughness: 0.42, normalMap: tx.dimple, normalScale: new THREE.Vector2(0.8, 0.8) }),
    exhaust: S({ color: "#8a8681", metalness: 0.75, roughness: 0.55, normalMap: tx.cast, normalScale: new THREE.Vector2(0.2, 0.2) }),
    battery: S({ color: "#1d1e21", roughness: 0.55, metalness: 0.05 }),
    batteryLabel: S({ map: labelTexture(["12V  AGM", "H5 · 650 CCA", "Crankwell"]), roughness: 0.6 }),
    ceramic: S({ color: "#f1efe8", roughness: 0.3, metalness: 0 }),
    plate: S({ map: plateTexture(), roughness: 0.4, metalness: 0.1 }),
    radiatorCore: S({ color: "#7f858d", metalness: 0.85, roughness: 0.45, normalMap: tx.fins, normalScale: new THREE.Vector2(1.5, 1.5) }),
    redPlastic: S({ color: "#b4121b", roughness: 0.45 }),
    bluePlastic: S({ color: "#1d4ed8", roughness: 0.45 }),
    yellow: S({ color: "#f2c230", roughness: 0.45 }),
  };
  if (opts.wheelDark) m.wheelFace = m.wheelDark;
  return m;
}

// 1 - |n·v|, kept in [0, 1]. Rounding can push |n·v| past 1 when a face looks straight at the
// camera, and pow() of a negative base is NaN, which bloom then spreads over the whole frame.
// Zero-length normals (degenerate triangles) are guarded the same way.
const RIM = /* glsl */ `
      float rim(vec3 n, vec3 v) {
        n *= inversesqrt(max(dot(n, n), 1e-12));
        v *= inversesqrt(max(dot(v, v), 1e-12));
        return clamp(1.0 - abs(dot(n, v)), 0.0, 1.0);
      }`;

/** Fresnel "x-ray" shader used for ghosted parts and the see-through body. */
export function createXrayMaterial(color: string, opacity: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uPower: { value: 2.2 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal;
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; uniform float uPower;
      varying vec3 vN; varying vec3 vV;
      ${RIM}
      void main() {
        float f = pow(rim(vN, vV), uPower);
        gl_FragColor = vec4(uColor, uOpacity * (0.035 + 0.965 * f));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** Additive pulsing rim glow layered over highlighted parts. */
export function createGlowMaterial(color: string) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uStrength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal;
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime; uniform float uStrength;
      varying vec3 vN; varying vec3 vV;
      ${RIM}
      void main() {
        float f = pow(rim(vN, vV), 1.6);
        float pulse = 0.55 + 0.45 * sin(uTime * 4.0);
        gl_FragColor = vec4(uColor * (0.35 + 1.6 * f) * pulse * uStrength, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
}
