import type { Metadata } from "next";
import { App } from "@/components/App";

export const metadata: Metadata = { title: "Garage · Crankwell" };

export default function Garage() {
  return <App />;
}
