import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";
import { MODEL_LABEL, PROVIDER } from "@/lib/agent/model";

export const metadata: Metadata = {
  title: "Crankwell · Your car, explained",
  description: "Tell it what's wrong, watch it find it. An AI mechanic that diagnoses your car on a live 3D model and pays for the fix with PayPal.",
};

export default function Home() {
  // Judges need a sandbox buyer to try checkout; shown only when configured.
  const email = process.env.SANDBOX_BUYER_EMAIL;
  const password = process.env.SANDBOX_BUYER_PASSWORD;
  // The address to paste into Claude as a connector.
  const mcpUrl = `${(process.env.PUBLIC_URL ?? "https://crankwell.xyz").replace(/\/$/, "")}/api/mcp`;
  return <Landing sandbox={email && password ? { email, password } : null} agent={{ label: MODEL_LABEL, provider: PROVIDER }} mcpUrl={mcpUrl} />;
}
