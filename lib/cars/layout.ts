import { getTemplate, type TemplateKey } from "./parts-library";
import type { Assembly, BuildParam, CarModel, CarSpec, PartInstance, PriceRange, Vec3 } from "./types";

type AddArgs = {
  id: string;
  template: TemplateKey;
  name?: string;
  position?: Vec3;
  rotation?: Vec3;
  mirror?: boolean;
  kind: string;
  params?: Record<string, BuildParam>;
  explode: Vec3;
  stage: number;
  assembly?: string;
  note?: string;
  price?: PriceRange;
};

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const flat = (pts: Vec3[]) => pts.flatMap((p) => p);
/** Several polylines packed into one array: [n, x,y,z × n, n, ...] */
const packPaths = (paths: Vec3[][]) => paths.flatMap((p) => [p.length, ...flat(p)]);

/** Euler XYZ rotation that turns local +Y toward `to - from`. */
export function alignY(from: Vec3, to: Vec3): { rotation: Vec3; length: number } {
  const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = Math.hypot(d[0], d[1], d[2]);
  const [dx, dy, dz] = d.map((v) => v / length);
  return { rotation: [Math.atan2(dz, dy), 0, -Math.asin(Math.max(-1, Math.min(1, dx)))], length };
}

export function buildLayout(spec: CarSpec): CarModel {
  const parts: PartInstance[] = [];
  const add = (a: AddArgs) => {
    const tpl = getTemplate(a.template);
    parts.push({
      id: a.id,
      template: a.template,
      name: a.name ?? tpl.name,
      system: tpl.system,
      position: a.position ?? [0, 0, 0],
      rotation: a.rotation,
      mirror: a.mirror,
      build: { kind: a.kind, params: a.params },
      explode: a.explode,
      stage: a.stage,
      assembly: a.assembly,
      note: a.note,
      price: a.price,
    });
  };

  const { dims, body } = spec;
  const R = dims.tireRadius;
  const axF = dims.wheelbase / 2;
  const axR = -dims.wheelbase / 2;
  const suv = body.style === "suv";
  const lift = suv ? 0.11 : 0; // SUV packaging sits higher
  const eo = spec.engineOrigin;
  const E = (p: Vec3): Vec3 => add3(eo, p); // engine-local → world
  const cowl = body.seams.cowl;
  const floorY = body.edge.find(([x]) => x >= -1.0)![1] + 0.025;
  const beltAtCowl = suv ? 1.075 : 0.94;
  const xRad = body.xFront - 0.3;

  const assemblies: Record<string, Assembly> = {
    shell: { offset: [0, 1.95, 0], stage: 0.1 },
    powertrain: { offset: [0.5, 0.95, 0], stage: 0.42 },
  };

  // ───────────────────────── Body ─────────────────────────
  add({ id: "body.shell", template: "body_shell", kind: "body_shell", explode: [0, 0, 0], stage: 0.1, assembly: "shell" });
  add({ id: "body.hood", template: "hood", kind: "panel", params: { panel: "hood" }, explode: [0.45, 1.45, 0], stage: 0.02 });
  add({ id: "body.front_bumper", template: "front_bumper", kind: "panel", params: { panel: "front_bumper" }, explode: [1.15, 0.05, 0], stage: 0 });
  add({ id: "body.rear_bumper", template: "rear_bumper", kind: "panel", params: { panel: "rear_bumper" }, explode: [-1.15, 0.05, 0], stage: 0 });
  add({ id: "body.grille", template: "grille", kind: "grille", explode: [1.5, 0.15, 0], stage: 0.01 });
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? "l" : "r";
    const side = s < 0 ? "Left" : "Right";
    add({ id: `body.fender.${L}`, template: "fender", name: `${side} front fender`, kind: "panel", params: { panel: "fender", side: s }, explode: [0.3, 0.15, s * 0.8], stage: 0.02 });
    add({ id: `body.door.f${L}`, template: "door", name: `${side} front door`, kind: "panel", params: { panel: "door_front", side: s }, explode: [0.05, 0.08, s * 1.15], stage: 0.04 });
    add({ id: `body.door.r${L}`, template: "door", name: `${side} rear door`, kind: "panel", params: { panel: "door_rear", side: s }, explode: [-0.05, 0.08, s * 1.15], stage: 0.05 });
    add({ id: `body.headlight.${L}`, template: "headlight", name: `${side} headlight`, kind: "panel", params: { panel: "headlight", side: s }, explode: [1.0, 0.35, s * 0.45], stage: 0.01 });
    add({ id: `body.taillight.${L}`, template: "taillight", name: `${side} tail light`, kind: "panel", params: { panel: "taillight", side: s }, explode: [-1.0, 0.35, s * 0.4], stage: 0.01 });
    add({ id: `body.mirror.${L}`, template: "side_mirror", name: `${side} side mirror`, kind: "mirror", params: { side: s }, explode: [0.05, 0.3, s * 1.55], stage: 0.04 });
  }
  if (suv) {
    add({ id: "body.tailgate", template: "tailgate", kind: "panel", params: { panel: "tailgate" }, explode: [-1.0, 0.85, 0], stage: 0.06 });
  } else {
    add({ id: "body.trunk", template: "trunk_lid", kind: "panel", params: { panel: "trunk" }, explode: [-0.8, 1.15, 0], stage: 0.06 });
    add({ id: "body.rear_window", template: "rear_window", kind: "panel", params: { panel: "rear_window" }, explode: [-0.55, 0.5, 0], stage: 0.08, assembly: "shell" });
  }
  add({ id: "body.windshield", template: "windshield", kind: "panel", params: { panel: "windshield" }, explode: [0.55, 0.45, 0], stage: 0.08, assembly: "shell" });

  // ───────────────────────── Interior ─────────────────────────
  const seatY = floorY + (suv ? 0.2 : 0.11);
  add({ id: "interior.dashboard", template: "dashboard", kind: "dashboard", position: [cowl - 0.22, beltAtCowl - 0.08, 0], params: { width: body.wBelt * 1.72, suv }, explode: [0.35, 1.45, 0], stage: 0.14 });
  for (const s of [-1, 1] as const) {
    add({
      id: `interior.seat.f${s < 0 ? "l" : "r"}`,
      template: "front_seat",
      name: s < 0 ? "Driver seat" : "Front passenger seat",
      kind: "seat",
      position: [-0.02, seatY, s * 0.37],
      params: { suv },
      explode: [0, 1.15, s * 0.35],
      stage: 0.15,
    });
  }
  add({ id: "interior.seat.rear", template: "rear_seat", kind: "rear_seat", position: [-0.86, seatY + 0.05, 0], params: { width: body.wBelt * 1.55, suv }, explode: [-0.25, 1.2, 0], stage: 0.16 });

  // ───────────────────────── Wheels, brakes, hubs, knuckles ─────────────────────────
  const corners = [
    { key: "fl", label: "Front-left", ax: axF, s: -1, front: true, track: dims.trackF },
    { key: "fr", label: "Front-right", ax: axF, s: 1, front: true, track: dims.trackF },
    { key: "rl", label: "Rear-left", ax: axR, s: -1, front: false, track: dims.trackR },
    { key: "rr", label: "Rear-right", ax: axR, s: 1, front: false, track: dims.trackR },
  ] as const;

  const tirePrice: PriceRange = suv
    ? { partMin: 150, partMax: 280, laborMin: 25, laborMax: 45, unit: "each, 235/60R18 + mount/balance" }
    : { partMin: 120, partMax: 230, laborMin: 25, laborMax: 45, unit: "each, 225/45R17 + mount/balance" };

  for (const c of corners) {
    const zc = (c.s * c.track) / 2;
    const at: Vec3 = [c.ax, R, zc];
    const mirror = c.s < 0;
    const rotorR = c.front ? dims.rotorRadiusF : dims.rotorRadiusR;
    add({ id: `wheels.tire.${c.key}`, template: "tire", name: `${c.label} tire`, kind: "tire", position: at, mirror, params: { radius: R, width: dims.tireWidth, rim: dims.rimRadius }, explode: [0, 0, c.s * 1.05], stage: 0.28, price: tirePrice });
    add({ id: `wheels.rim.${c.key}`, template: "rim", name: `${c.label} alloy wheel`, kind: "rim", position: at, mirror, params: { rim: dims.rimRadius, width: dims.tireWidth, style: spec.id }, explode: [0, 0, c.s * 0.78], stage: 0.27 });
    const rotorAt: Vec3 = [c.ax, R, zc - c.s * 0.004];
    add({ id: `brakes.rotor.${c.key}`, template: "brake_rotor", name: `${c.label} brake rotor`, kind: "rotor", position: rotorAt, mirror, params: { radius: rotorR, vented: c.front }, explode: [0, 0, c.s * 0.34], stage: 0.34 });
    add({ id: `brakes.caliper.${c.key}`, template: "brake_caliper", name: `${c.label} brake caliper`, kind: "caliper", position: rotorAt, mirror, params: { rotor: rotorR, angle: c.front ? 168 : 196, front: c.front, epb: !c.front }, explode: [c.front ? -0.12 : 0.12, 0.22, c.s * 0.58], stage: 0.32 });
    add({ id: `brakes.pads.${c.key}`, template: "brake_pads", name: `${c.label} brake pads`, kind: "pads", position: rotorAt, mirror, params: { rotor: rotorR, angle: c.front ? 168 : 196 }, explode: [c.front ? -0.1 : 0.1, 0.42, c.s * 0.46], stage: 0.36 });
    add({ id: `suspension.hub.${c.key}`, template: "hub_bearing", name: `${c.label} hub bearing`, kind: "hub", position: [c.ax, R, zc], mirror, explode: [0, 0, c.s * 0.2], stage: 0.4 });
    if (c.front) {
      add({ id: `suspension.knuckle.${c.key}`, template: "knuckle", name: `${c.label} steering knuckle`, kind: "knuckle", position: [c.ax, R, zc - c.s * 0.1], mirror, params: { front: true }, explode: [0, -0.05, c.s * 0.1], stage: 0.44 });
    }
  }

  // ───────────────────────── Suspension ─────────────────────────
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? "l" : "r";
    const side = s < 0 ? "Left" : "Right";
    const zf = (s * dims.trackF) / 2;
    const zr = (s * dims.trackR) / 2;

    const sb: Vec3 = [axF - 0.02, R + 0.1, zf - s * 0.135];
    const st: Vec3 = [axF - 0.06, R + 0.5 + lift * 0.4, zf - s * 0.215];
    const a = alignY(sb, st);
    add({ id: `suspension.strut.f${L}`, template: "front_strut", name: `${side} front strut`, kind: "strut", position: sb, rotation: a.rotation, params: { length: a.length, spring: 0.075 }, explode: [0, 0.55, s * 0.3], stage: 0.42 });

    const ball: Vec3 = [axF + 0.01, R - 0.14, zf - s * 0.115];
    add({
      id: `suspension.lca.f${L}`,
      template: "lower_control_arm",
      name: `${side} front lower control arm`,
      kind: "arm",
      params: { points: flat([ball, [axF + 0.06, R - 0.12, s * 0.36], [axF - 0.32, R - 0.11, s * 0.38]]), ball: true },
      explode: [0, -0.3, s * 0.32],
      stage: 0.46,
    });

    const rb: Vec3 = [axR - 0.1, R - 0.05, zr - s * 0.13];
    const rt: Vec3 = [axR - 0.14, R + 0.42 + lift * 0.4, zr - s * 0.24];
    const ra = alignY(rb, rt);
    add({ id: `suspension.shock.r${L}`, template: "rear_shock", name: `${side} rear shock & spring`, kind: "strut", position: rb, rotation: ra.rotation, params: { length: ra.length, spring: 0.06, rear: true }, explode: [0, 0.55, s * 0.3], stage: 0.42 });

    const kn = zr - s * 0.1;
    add({
      id: `suspension.rear_arms.${L}`,
      template: "rear_arms",
      name: `${side} rear multi-link arms`,
      kind: "links",
      params: {
        segs: flat([
          [axR + 0.0, R - 0.13, kn], [axR + 0.02, R - 0.13, s * 0.33],
          [axR - 0.02, R + 0.13, kn], [axR + 0.0, R + 0.16, s * 0.4],
          [axR + 0.13, R - 0.03, kn], [axR + 0.16, R - 0.04, s * 0.33],
          [axR - 0.05, R - 0.09, kn - s * 0.03], [axR - 0.38, R - 0.06, s * 0.45],
        ]),
        radius: 0.016,
      },
      explode: [0, -0.3, s * 0.3],
      stage: 0.46,
    });
  }

  add({
    id: "suspension.subframe.front",
    template: "subframe",
    name: "Front subframe",
    kind: "subframe",
    position: [axF - 0.15, R - 0.13, 0],
    params: { length: 0.58, width: 0.82, front: true },
    explode: [0, -0.62, 0],
    stage: 0.55,
  });
  add({
    id: "suspension.subframe.rear",
    template: "subframe",
    name: "Rear subframe",
    kind: "subframe",
    position: [axR - 0.0, R - 0.1, 0],
    params: { length: 0.42, width: 0.86, front: false },
    explode: [0, -0.62, 0],
    stage: 0.55,
  });
  add({
    id: "suspension.swaybar.front",
    template: "sway_bar",
    name: "Front stabilizer bar",
    kind: "swaybar",
    params: {
      points: flat([
        [axF - 0.06, R + 0.12, -(dims.trackF / 2 - 0.22)],
        [axF - 0.2, R - 0.05, -(dims.trackF / 2 - 0.3)],
        [axF - 0.24, R - 0.06, -0.3],
        [axF - 0.24, R - 0.06, 0.3],
        [axF - 0.2, R - 0.05, dims.trackF / 2 - 0.3],
        [axF - 0.06, R + 0.12, dims.trackF / 2 - 0.22],
      ]),
    },
    explode: [0, -0.48, 0],
    stage: 0.5,
  });
  add({
    id: "suspension.swaybar.rear",
    template: "sway_bar",
    name: "Rear stabilizer bar",
    kind: "swaybar",
    params: {
      points: flat([
        [axR + 0.04, R + 0.08, -(dims.trackR / 2 - 0.22)],
        [axR + 0.2, R - 0.06, -(dims.trackR / 2 - 0.3)],
        [axR + 0.24, R - 0.07, -0.25],
        [axR + 0.24, R - 0.07, 0.25],
        [axR + 0.2, R - 0.06, dims.trackR / 2 - 0.3],
        [axR + 0.04, R + 0.08, dims.trackR / 2 - 0.22],
      ]),
    },
    explode: [0, -0.48, 0],
    stage: 0.5,
  });

  // ───────────────────────── Steering ─────────────────────────
  const rackX = axF - 0.15;
  const rackY = R - 0.03;
  add({ id: "steering.rack", template: "steering_rack", kind: "rack", position: [rackX, rackY, 0], params: { length: 0.74 }, explode: [-0.1, -0.42, 0], stage: 0.48 });
  for (const s of [-1, 1] as const) {
    add({
      id: `steering.tie_rod.${s < 0 ? "l" : "r"}`,
      template: "tie_rod",
      name: `${s < 0 ? "Left" : "Right"} tie rod`,
      kind: "tie_rod",
      params: { points: flat([[rackX, rackY, s * 0.37], [axF - 0.16, rackY + 0.01, s * (dims.trackF / 2 - 0.12)]]) },
      explode: [0, -0.36, s * 0.22],
      stage: 0.47,
    });
  }
  const wheelC: Vec3 = [0.44, (suv ? 1.04 : 0.9) + 0.0, -0.37];
  const fw: Vec3 = [cowl, beltAtCowl - 0.32, -0.33];
  add({
    id: "steering.column",
    template: "steering_column",
    kind: "column",
    params: { points: flat([[rackX + 0.02, rackY + 0.06, -0.28], fw, add3(wheelC, [0.07, -0.04, 0])]) },
    explode: [-0.15, 0.85, 0],
    stage: 0.2,
  });
  const colAlign = alignY(fw, wheelC);
  add({ id: "steering.wheel", template: "steering_wheel", kind: "steering_wheel", position: wheelC, rotation: colAlign.rotation, explode: [-0.35, 1.05, 0], stage: 0.19 });

  // ───────────────────────── Brakes (hydraulics) ─────────────────────────
  const bY = beltAtCowl - 0.23;
  const mcFront: Vec3 = [cowl + 0.34, bY, -0.42];
  add({ id: "brakes.booster", template: "brake_booster", kind: "booster", position: [cowl + 0.08, bY, -0.42], explode: [0.05, 0.55, -0.05], stage: 0.3 });
  add({ id: "brakes.master_cylinder", template: "master_cylinder", kind: "master_cylinder", position: [cowl + 0.15, bY, -0.42], params: { length: 0.19 }, explode: [0.3, 0.68, -0.05], stage: 0.3 });
  add({ id: "brakes.reservoir", template: "brake_reservoir", kind: "reservoir", position: [cowl + 0.25, bY + 0.075, -0.42], params: { fluid: "brake" }, explode: [0.32, 1.0, -0.05], stage: 0.29 });
  const abs: Vec3 = [cowl + 0.16, bY - 0.25, -0.24];
  add({ id: "brakes.abs", template: "abs_module", kind: "abs", position: abs, explode: [0.2, 0.45, -0.25], stage: 0.31 });
  add({ id: "brakes.pedal", template: "brake_pedal", kind: "pedal", params: { points: flat([[cowl - 0.04, beltAtCowl - 0.3, -0.42], [cowl - 0.17, floorY + 0.24, -0.42]]) }, explode: [-0.35, 0.65, -0.1], stage: 0.22 });

  const caliperPt = (ax: number, s: number, track: number, front: boolean): Vec3 => [ax + (front ? -0.12 : -0.13), R + 0.03, s * (track / 2 - 0.05)];
  add({
    id: "brakes.lines",
    template: "brake_lines",
    kind: "tubes",
    params: {
      paths: packPaths([
        [add3(mcFront, [-0.07, -0.01, 0.0]), [cowl + 0.3, bY - 0.12, -0.36], add3(abs, [0.03, 0.06, -0.03])],
        [add3(abs, [0.06, 0, -0.06]), [cowl + 0.32, bY - 0.32, -0.55], [axF - 0.12, R + 0.24, -(dims.trackF / 2 - 0.24)], caliperPt(axF, -1, dims.trackF, true)],
        [add3(abs, [0.06, 0, 0.06]), [cowl + 0.07, bY - 0.3, 0.0], [cowl + 0.12, bY - 0.3, 0.5], [axF - 0.12, R + 0.24, dims.trackF / 2 - 0.24], caliperPt(axF, 1, dims.trackF, true)],
        [add3(abs, [0, -0.06, 0]), [cowl - 0.02, floorY + 0.02, -0.18], [axR + 0.42, floorY - 0.02, -0.16], [axR + 0.2, R + 0.12, -(dims.trackR / 2 - 0.25)], caliperPt(axR, -1, dims.trackR, false)],
        [add3(abs, [0, -0.06, 0.02]), [cowl - 0.02, floorY + 0.02, -0.12], [axR + 0.42, floorY - 0.02, -0.1], [axR + 0.38, floorY - 0.02, 0.16], [axR + 0.2, R + 0.12, dims.trackR / 2 - 0.25], caliperPt(axR, 1, dims.trackR, false)],
      ]),
      radius: 0.0045,
      color: "steel",
    },
    explode: [0, -0.32, 0],
    stage: 0.52,
  });

  // ───────────────────────── Powertrain (engine-local coordinates) ─────────────────────────
  const pt = "powertrain";
  const cyl = [-0.138, -0.046, 0.046, 0.138];
  add({ id: "engine.block", template: "engine_block", kind: "engine_block", position: E([0, 0, 0]), params: { turbo: spec.turbo }, explode: [0, 0, 0], stage: 0.6, assembly: pt });
  add({ id: "engine.head", template: "cylinder_head", kind: "cylinder_head", position: E([0, 0.25, 0]), explode: [0, 0.42, 0], stage: 0.66, assembly: pt });
  add({ id: "engine.valve_cover", template: "valve_cover", kind: "valve_cover", position: E([0, 0.385, 0]), params: { brand: spec.id }, explode: [0, 0.78, 0], stage: 0.6, assembly: pt });
  add({ id: "engine.camshafts", template: "camshafts", kind: "camshafts", position: E([0, 0.345, 0]), explode: [0, 0.6, 0], stage: 0.68, assembly: pt });
  add({ id: "engine.ignition_coils", template: "ignition_coils", kind: "coils", position: E([0, 0.41, 0]), params: { cyl: cyl }, explode: [0, 1.05, 0], stage: 0.58, assembly: pt });
  add({ id: "engine.spark_plugs", template: "spark_plugs", kind: "plugs", position: E([0, 0.3, 0]), params: { cyl: cyl }, explode: [0, 0.92, 0.0], stage: 0.62, assembly: pt });
  cyl.forEach((zc, i) => {
    const crank = [0, 180, 180, 0][i];
    add({ id: `engine.piston.${i + 1}`, template: "piston", name: `Piston & rod, cylinder ${i + 1}`, kind: "piston", position: E([0, 0, zc]), params: { crank }, explode: [0, 0.3 + (i % 2) * 0.04, 0], stage: 0.76, assembly: pt });
  });
  add({ id: "engine.crankshaft", template: "crankshaft", kind: "crankshaft", position: E([0, 0, 0]), params: { cyl: cyl }, explode: [0, -0.38, 0], stage: 0.74, assembly: pt });
  add({ id: "engine.oil_pan", template: "oil_pan", kind: "oil_pan", position: E([0, -0.075, 0]), explode: [0, -0.68, 0], stage: 0.62, assembly: pt });
  add({ id: "engine.timing_chain", template: "timing_chain", kind: "timing_chain", position: E([0, 0, 0.245]), explode: [0, 0.05, 0.38], stage: 0.63, assembly: pt });
  add({ id: "engine.oil_filter", template: "oil_filter", kind: "oil_filter", position: E([0.175, -0.02, 0.06]), explode: [0.32, -0.12, 0.05], stage: 0.58, assembly: pt });

  const pulleys: number[] = spec.turbo
    ? [0, 0, 0.075, 0.155, -0.035, 0.06, 0.15, 0.25, 0.06, 0.065, 0.31, 0.055, 0.075, 0.12, 0.04]
    : [0, 0, 0.075, 0.15, -0.04, 0.06, 0.16, 0.24, 0.06, 0.08, 0.13, 0.04];
  add({ id: "engine.serpentine_belt", template: "serpentine_belt", kind: "belt", position: E([0, 0, 0.305]), params: { pulleys }, explode: [0, 0.0, 0.62], stage: 0.56, assembly: pt });
  add({ id: "engine.tensioner", template: "belt_tensioner", kind: "tensioner", position: E(spec.turbo ? [0.075, 0.12, 0.29] : [0.08, 0.13, 0.29]), explode: [0.0, 0.0, 0.5], stage: 0.57, assembly: pt });
  add({ id: "electrical.alternator", template: "alternator", kind: "alternator", position: E([0.16, 0.24, 0.205]), explode: [0.32, 0.1, 0.42], stage: 0.56, assembly: pt });
  add({ id: "electrical.starter", template: "starter", kind: "starter", position: E([-0.13, -0.01, -0.3]), explode: [-0.18, -0.22, -0.4], stage: 0.56, assembly: pt });
  add({
    id: "engine.mounts",
    template: "engine_mounts",
    name: "Engine & transmission mounts",
    kind: "mounts",
    position: E([0, 0, 0]),
    params: { points: [0.0, 0.34, 0.36, 0.02, 0.22, -0.66, -0.24, -0.06, -0.14] },
    explode: [0, 0.12, 0],
    stage: 0.5,
    assembly: pt,
  });
  add({
    id: "cooling.water_pump",
    template: "water_pump",
    kind: "water_pump",
    position: E(spec.turbo ? [0.065, 0.31, 0.25] : [0.18, 0.1, 0.18]),
    params: { electric: !spec.turbo },
    explode: [0.32, 0.08, 0.32],
    stage: 0.57,
    assembly: pt,
    note: spec.turbo ? "The L15B uses a belt-driven mechanical pump." : "The M20A uses an electric water pump, so a failure can trigger an overheating warning even with a good belt.",
    price: spec.turbo
      ? { partMin: 70, partMax: 250, laborMin: 250, laborMax: 500 }
      : { partMin: 250, partMax: 600, laborMin: 200, laborMax: 400, unit: "electric pump" },
  });
  add({ id: "cooling.thermostat", template: "thermostat", kind: "thermostat", position: E([0.12, 0.27, -0.235]), explode: [0.3, 0.3, -0.3], stage: 0.58, assembly: pt });
  add({ id: "intake.manifold", template: "intake_manifold", kind: "intake_manifold", position: E([0.155, 0.3, 0]), params: { cyl: cyl }, explode: [0.55, 0.32, 0], stage: 0.55, assembly: pt });
  add({ id: "intake.throttle_body", template: "throttle_body", kind: "throttle_body", position: E([0.29, 0.33, -0.235]), explode: [0.62, 0.38, -0.3], stage: 0.54, assembly: pt });
  add({ id: "fuel.rail", template: "fuel_rail", kind: "fuel_rail", position: E([0.135, 0.235, 0]), params: { cyl: cyl }, explode: [0.36, 0.14, 0], stage: 0.6, assembly: pt });
  add({ id: "exhaust.manifold", template: "exhaust_manifold", kind: "exhaust_manifold", position: E([-0.16, 0.27, 0]), params: { cyl: cyl, turbo: spec.turbo }, explode: [-0.45, 0.12, 0], stage: 0.55, assembly: pt, note: spec.turbo ? "On the L15B the exhaust manifold is cast into the cylinder head and feeds the turbo directly." : undefined });
  add({ id: "transmission.cvt", template: "cvt", kind: "cvt", position: E([0, 0, -0.245]), params: { awd: spec.drivetrain === "AWD" }, explode: [0, 0, -0.55], stage: 0.52, assembly: pt });
  if (spec.turbo) {
    add({ id: "intake.turbo", template: "turbocharger", kind: "turbo", position: E([-0.26, 0.17, -0.02]), explode: [-0.62, 0.1, -0.22], stage: 0.53, assembly: pt });
  }
  if (spec.drivetrain === "AWD") {
    add({ id: "drivetrain.ptu", template: "ptu", kind: "ptu", position: E([-0.1, -0.11, -0.26]), explode: [-0.1, -0.22, -0.34], stage: 0.53, assembly: pt });
  }

  // ───────────────────────── Cooling (body-mounted) ─────────────────────────
  const radY = (suv ? 0.62 : 0.5) + 0;
  const radH = suv ? 0.44 : 0.38;
  add({ id: "cooling.radiator", template: "radiator", kind: "radiator", position: [xRad, radY, 0], params: { width: 0.68, height: radH }, explode: [0.75, 0.42, 0], stage: 0.38 });
  add({ id: "cooling.fans", template: "cooling_fans", kind: "fans", position: [xRad - 0.07, radY, 0], params: { width: 0.66, height: radH - 0.02 }, explode: [0.42, 0.36, 0], stage: 0.4 });
  add({
    id: "cooling.hose_upper",
    template: "radiator_hose_upper",
    kind: "tubes",
    params: { paths: packPaths([[E([0.12, 0.3, -0.2]), E([0.25, 0.36, -0.22]), [xRad - 0.18, radY + radH / 2 - 0.02, -0.28], [xRad - 0.03, radY + radH / 2 - 0.06, -0.3]]]), radius: 0.017, color: "rubber" },
    explode: [0.52, 0.65, 0],
    stage: 0.4,
  });
  add({
    id: "cooling.hose_lower",
    template: "radiator_hose_lower",
    kind: "tubes",
    params: { paths: packPaths([[[xRad - 0.03, radY - radH / 2 + 0.05, 0.3], [xRad - 0.2, radY - radH / 2 + 0.02, 0.3], E([0.25, -0.0, 0.22]), E(spec.turbo ? [0.12, 0.2, 0.24] : [0.2, 0.06, 0.16])]]), radius: 0.018, color: "rubber" },
    explode: [0.5, 0.2, 0.15],
    stage: 0.41,
  });
  add({ id: "cooling.reservoir", template: "coolant_reservoir", kind: "reservoir", position: [xRad - 0.16, radY + radH / 2 + 0.05, 0.55], params: { fluid: "coolant" }, explode: [0.45, 0.8, 0.25], stage: 0.37 });

  // ───────────────────────── Electrical (body-mounted) ─────────────────────────
  add({ id: "electrical.battery", template: "battery", kind: "battery", position: [xRad - 0.3, radY + 0.13, -0.54], explode: [0.25, 0.85, -0.25], stage: 0.34 });
  add({ id: "electrical.fuse_box", template: "fuse_box", kind: "fuse_box", position: [cowl + 0.26, beltAtCowl - 0.18, 0.56], explode: [0.15, 0.75, 0.25], stage: 0.34 });
  add({ id: "electrical.ecu", template: "ecu", kind: "ecu", position: [cowl + 0.1, beltAtCowl - 0.24, 0.56], explode: [0.0, 0.62, 0.42], stage: 0.35 });

  // ───────────────────────── Intake (body-mounted) ─────────────────────────
  const airbox: Vec3 = [eo[0] + 0.02, eo[1] + 0.41, -0.47];
  add({
    id: "intake.air_box",
    template: "air_box",
    kind: "air_box",
    position: airbox,
    params: {
      duct: flat(spec.turbo
        ? [[0.0, 0.0, 0.14], [-0.1, -0.06, 0.3], [-0.24, -0.16, 0.36], [-0.27, -0.24, 0.44]]
        : [[0.08, 0.0, 0.14], [0.2, -0.04, 0.22], [0.27, -0.08, 0.24]]),
    },
    explode: [0.1, 0.92, -0.2],
    stage: 0.33,
  });
  add({ id: "intake.maf", template: "maf_sensor", kind: "maf", position: add3(airbox, spec.turbo ? [-0.03, -0.01, 0.17] : [0.07, 0.01, 0.15]), explode: [0.15, 1.18, -0.2], stage: 0.32 });
  if (spec.turbo) {
    const ic: Vec3 = [xRad + 0.08, 0.36, 0];
    add({ id: "intake.intercooler", template: "intercooler", kind: "radiator", position: ic, params: { width: 0.62, height: 0.16, intercooler: true }, explode: [0.9, -0.1, 0], stage: 0.39 });
    add({
      id: "intake.charge_pipes",
      template: "charge_pipes",
      kind: "tubes",
      params: {
        paths: packPaths([
          [E([-0.25, 0.2, -0.13]), E([-0.2, 0.0, -0.3]), E([0.05, -0.18, -0.36]), [xRad - 0.1, ic[1] - 0.02, -0.36], [xRad + 0.06, ic[1], -0.33]],
          [[xRad + 0.06, ic[1], 0.33], [xRad - 0.12, ic[1] + 0.02, 0.36], E([0.32, 0.0, 0.0]), E([0.42, 0.25, -0.2]), E([0.34, 0.33, -0.26])],
        ]),
        radius: 0.028,
        color: "alu",
      },
      explode: [0.55, -0.15, 0],
      stage: 0.4,
    });
  }

  // ───────────────────────── Drivetrain ─────────────────────────
  const diffOut: Vec3 = [axF, R, -0.12];
  for (const s of [-1, 1] as const) {
    const inner: Vec3 = s < 0 ? [axF, R + 0.0, -0.36] : [axF, R + 0.0, 0.12];
    add({
      id: `drivetrain.cv_axle.f${s < 0 ? "l" : "r"}`,
      template: "cv_axle",
      name: `${s < 0 ? "Left" : "Right"} front CV axle`,
      kind: "cv_axle",
      params: { points: flat([inner, [axF, R, s * (dims.trackF / 2 - 0.1)]]) },
      explode: [0, -0.22, s * 0.3],
      stage: 0.48,
    });
  }
  void diffOut;
  if (spec.drivetrain === "AWD") {
    add({
      id: "drivetrain.propshaft",
      template: "propshaft",
      kind: "propshaft",
      params: { points: flat([add3(eo, [-0.22, -0.12, -0.2]), [cowl - 0.2, floorY + 0.05, 0.0], [axR + 0.25, R + 0.02, 0.0]]) },
      explode: [0, -0.5, 0],
      stage: 0.5,
    });
    add({ id: "drivetrain.rear_diff", template: "rear_diff", kind: "rear_diff", position: [axR + 0.06, R + 0.02, 0], explode: [-0.12, -0.48, 0], stage: 0.52 });
    for (const s of [-1, 1] as const) {
      add({
        id: `drivetrain.cv_axle.r${s < 0 ? "l" : "r"}`,
        template: "cv_axle",
        name: `${s < 0 ? "Left" : "Right"} rear CV axle`,
        kind: "cv_axle",
        params: { points: flat([[axR + 0.03, R + 0.02, s * 0.13], [axR, R, s * (dims.trackR / 2 - 0.1)]]) },
        explode: [0, -0.22, s * 0.3],
        stage: 0.48,
      });
    }
  }

  // ───────────────────────── Fuel ─────────────────────────
  const tankY = floorY + 0.06 + (suv ? 0.04 : 0);
  add({ id: "fuel.tank", template: "fuel_tank", kind: "fuel_tank", position: [-0.82, tankY, 0], params: { awd: spec.drivetrain === "AWD" }, explode: [0, -0.58, 0], stage: 0.48, note: suv ? "14.0 gal capacity." : "13.2 gal capacity." });
  add({ id: "fuel.pump", template: "fuel_pump", kind: "fuel_pump", position: [-0.82, tankY + 0.12, 0.3], explode: [0, 0.48, 0.15], stage: 0.47 });
  add({
    id: "fuel.lines",
    template: "fuel_lines",
    kind: "tubes",
    params: {
      paths: packPaths([[[-0.82, tankY + 0.14, 0.24], [-0.55, floorY - 0.02, 0.36], [cowl - 0.1, floorY - 0.02, 0.38], [cowl + 0.12, eo[1] - 0.05, 0.42], E([0.2, 0.15, 0.25]), E([0.14, 0.24, 0.2])]]),
      radius: 0.005,
      color: "black",
    },
    explode: [0, -0.3, 0.2],
    stage: 0.5,
  });

  // ───────────────────────── Exhaust ─────────────────────────
  const exOut = E(spec.turbo ? [-0.32, 0.02, 0.06] : [-0.25, -0.02, -0.02]);
  const catIn: Vec3 = [cowl + 0.0, floorY + 0.06, 0.06];
  const catOut: Vec3 = [cowl - 0.42, floorY + 0.04, 0.05];
  const mufIn: Vec3 = [axR - 0.36, R - 0.05, 0.12];
  add({ id: "exhaust.cat", template: "catalytic_converter", kind: "catalytic", params: { points: flat([catIn, catOut]) }, explode: [0, -0.5, 0], stage: 0.5 });
  add({
    id: "exhaust.center_pipe",
    template: "center_pipe",
    kind: "center_pipe",
    params: {
      points: flat([exOut, add3(exOut, [-0.06, -0.12, 0.0]), [cowl + 0.08, floorY + 0.08, 0.06], catIn]),
      points2: flat([catOut, [-0.2, floorY + 0.02, 0.05], [-0.8, floorY + 0.02, 0.06], [axR + 0.42, floorY + 0.06, 0.07], [axR + 0.18, R + 0.02, 0.1], [axR - 0.18, R + 0.0, 0.11], mufIn]),
      resonator: flat([[-0.25, floorY + 0.02, 0.05], [-0.7, floorY + 0.02, 0.06]]),
    },
    explode: [0, -0.58, 0],
    stage: 0.5,
  });
  add({ id: "exhaust.muffler", template: "muffler", kind: "muffler", position: [axR - 0.62, R - 0.07, 0.18], params: { tipZ: suv ? 0.52 : 0.46, tipX: body.xRear + 0.05 - (axR - 0.62) }, explode: [-0.45, -0.45, 0], stage: 0.5 });
  add({ id: "exhaust.o2_sensors", template: "o2_sensors", kind: "o2_sensors", params: { points: flat([add3(exOut, [0.0, 0.06, 0.035]), add3(catOut, [-0.05, 0.05, 0.0])]) }, explode: [0, -0.15, 0.32], stage: 0.49 });

  return { spec, parts, assemblies };
}
