import { useId } from "react";
import { CAR_SPECS } from "@/lib/cars/specs";
import type { CarId } from "@/lib/cars/types";

const S = 100; // svg units per meter
const pt = ([x, y]: [number, number] | number[]) => `${(x * S).toFixed(1)},${(-y * S).toFixed(1)}`;
const mm = (m: number) => Math.round(m * 1000).toLocaleString("en-US").replace(",", " ");

/** A side elevation drawn from the car's spec: body profile, wheels and principal dimensions. */
export function Elevation({ carId = "corolla", className }: { carId?: CarId; className?: string }) {
  const spec = CAR_SPECS[carId];
  const { body, dims } = spec;
  // The drawing can be on the page more than once: ids are per instance.
  const uid = useId();
  const clip = `sill-${uid}`;
  const arrow = `arw-${uid}`;
  const wheels = [-dims.wheelbase / 2, dims.wheelbase / 2];
  const arch = dims.tireRadius + body.archGap + 0.03;
  const sill = Math.max(...body.edge.map(([, y]) => y));
  const outline = [...body.top, ...[...body.edge].reverse()].map(pt).join(" ");
  const belt = body.belt.filter(([x]) => x >= body.seams.deck - 0.05 && x <= body.seams.cowl + 0.05);
  const topAt = (x: number) => {
    const t = body.top;
    for (let i = 1; i < t.length; i++) if (t[i][0] >= x) return t[i - 1][1] + ((x - t[i - 1][0]) / (t[i][0] - t[i - 1][0])) * (t[i][1] - t[i - 1][1]);
    return t[t.length - 1][1];
  };
  const beltAt = (x: number) => {
    const b = body.belt;
    for (let i = 1; i < b.length; i++) if (b[i][0] >= x) return b[i - 1][1] + ((x - b[i - 1][0]) / (b[i][0] - b[i - 1][0])) * (b[i][1] - b[i - 1][1]);
    return b[b.length - 1][1];
  };
  const x0 = body.xRear * S;
  const x1 = body.xFront * S;
  const hTop = -dims.height * S;
  const dimLen = 46;
  const dimWb = 26;
  const xH = x1 + 34;

  return (
    <svg viewBox="-280 -190 580 262" className={className} role="img" aria-label={`Side elevation of the ${spec.make} ${spec.model}: length ${mm(dims.length)} mm, wheelbase ${mm(dims.wheelbase)} mm, height ${mm(dims.height)} mm`}>
      <defs>
        <clipPath id={clip}>
          <rect x="-300" y="-300" width="600" height={300 - sill * S} />
        </clipPath>
        <marker id={arrow} viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,1 L6,4 L0,7" fill="none" stroke="currentColor" strokeWidth="1" />
        </marker>
      </defs>
      <g fill="none" stroke="currentColor" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
        {/* ground */}
        <line x1="-270" x2="290" y1="0" y2="0" strokeOpacity="0.35" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        {/* body */}
        <polygon points={outline} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
        <polyline points={belt.map(pt).join(" ")} strokeOpacity="0.55" vectorEffect="non-scaling-stroke" />
        {/* pillars and door shut lines */}
        {[[body.seams.cowl, body.seams.header], [body.seams.bPillar, body.seams.bPillar + 0.03], [body.seams.deck, body.seams.roofRear]].map(([a, b]) => (
          <line key={a} x1={a * S} y1={-beltAt(a) * S} x2={b * S} y2={-topAt(b) * S + 3} strokeOpacity="0.55" vectorEffect="non-scaling-stroke" />
        ))}
        {[body.seams.doorF, body.seams.bPillar, body.seams.doorR].map((x) => (
          <line key={`d${x}`} x1={x * S} x2={x * S} y1={-beltAt(x) * S} y2={-(sill + 0.04) * S} strokeOpacity="0.4" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
        ))}
        {/* wheel arches cut into the body above the sill */}
        <g clipPath={`url(#${clip})`}>
          {wheels.map((x) => <circle key={x} cx={x * S} cy={-dims.tireRadius * S} r={arch * S} className="fill-[var(--bg)]" vectorEffect="non-scaling-stroke" />)}
        </g>
        {/* wheels */}
        {wheels.map((x) => (
          <g key={x} transform={`translate(${x * S} ${-dims.tireRadius * S})`}>
            <circle r={dims.tireRadius * S} strokeWidth="1.25" className="fill-[var(--bg)]" vectorEffect="non-scaling-stroke" />
            <circle r={dims.rimRadius * S} strokeOpacity="0.7" vectorEffect="non-scaling-stroke" />
            <circle r={dims.rotorRadiusF * S * 0.9} strokeOpacity="0.35" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
            <circle r="4" strokeOpacity="0.7" vectorEffect="non-scaling-stroke" />
            <line x1="-9" x2="9" strokeOpacity="0.45" vectorEffect="non-scaling-stroke" />
            <line y1="-9" y2="9" strokeOpacity="0.45" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {/* dimensions */}
        <g strokeOpacity="0.55">
          <line x1={x0} x2={x0} y1="4" y2={dimLen + 4} vectorEffect="non-scaling-stroke" />
          <line x1={x1} x2={x1} y1="4" y2={dimLen + 4} vectorEffect="non-scaling-stroke" />
          <line x1={x0} x2={x1} y1={dimLen} y2={dimLen} markerStart={`url(#${arrow})`} markerEnd={`url(#${arrow})`} vectorEffect="non-scaling-stroke" />
          <line x1={wheels[0] * S} x2={wheels[0] * S} y1="6" y2={dimWb + 4} vectorEffect="non-scaling-stroke" />
          <line x1={wheels[1] * S} x2={wheels[1] * S} y1="6" y2={dimWb + 4} vectorEffect="non-scaling-stroke" />
          <line x1={wheels[0] * S} x2={wheels[1] * S} y1={dimWb} y2={dimWb} markerStart={`url(#${arrow})`} markerEnd={`url(#${arrow})`} vectorEffect="non-scaling-stroke" />
          <line x1={x1 + 6} x2={xH + 4} y1={hTop} y2={hTop} vectorEffect="non-scaling-stroke" />
          <line x1={xH} x2={xH} y1="0" y2={hTop} markerStart={`url(#${arrow})`} markerEnd={`url(#${arrow})`} vectorEffect="non-scaling-stroke" />
        </g>
      </g>
      <g fill="currentColor" className="font-mono" fontSize="9" letterSpacing="0.6">
        <text x={(x0 + x1) / 2} y={dimLen - 4} textAnchor="middle" className="fill-current" fillOpacity="0.8">L {mm(dims.length)}</text>
        <text x="0" y={dimWb - 4} textAnchor="middle" fillOpacity="0.8">WB {mm(dims.wheelbase)}</text>
        <text transform={`translate(${xH + 12} ${hTop / 2}) rotate(-90)`} textAnchor="middle" fillOpacity="0.8">H {mm(dims.height)}</text>
        <text x={wheels[1] * S} y={-dims.tireRadius * S - arch * S - 8} textAnchor="middle" fillOpacity="0.5" fontSize="7.5">{Math.round(dims.tireRadius * 2000)} ⌀</text>
      </g>
    </svg>
  );
}
