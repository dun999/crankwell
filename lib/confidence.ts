/** Shared by the chat and 3D labels; keep this helper independent of WebGL. */
export function confidenceColor(confidence: number) {
  return confidence >= 0.6 ? "#ff3b30" : confidence >= 0.3 ? "#ff9f0a" : "#facc15";
}
