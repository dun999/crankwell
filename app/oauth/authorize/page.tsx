import type { Metadata } from "next";
import { headers } from "next/headers";
import { ConsentForm } from "@/components/flow/ConsentForm";
import { FlowError, FlowShell } from "@/components/flow/FlowShell";
import { originFromHeaders } from "@/lib/server/http";
import { OAuthError, clientLabel, validateAuthRequest } from "@/lib/server/oauth";

export const metadata: Metadata = { title: "Connect to Crankwell" };

/** OAuth authorization endpoint. Invalid requests show an error here instead of redirecting. */
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  const sp = await searchParams;
  const params = Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : Array.isArray(v) && v[0] ? [[k, v[0]]] : [])));
  const origin = originFromHeaders(await headers());
  const checked = await validateAuthRequest(params, origin).then(
    (ok) => ({ ok: true as const, app: clientLabel(ok.client), redirectHost: new URL(ok.req.redirect_uri).host }),
    (e: unknown) => ({ ok: false as const, error: e instanceof OAuthError ? e.description : "Something went wrong." }),
  );
  return (
    <FlowShell eyebrow="Connect">
      {checked.ok ? (
        <ConsentForm params={params} app={checked.app} redirectHost={checked.redirectHost} />
      ) : (
        <FlowError title="This connection link isn't valid">{checked.error} Start the connection again from the app.</FlowError>
      )}
    </FlowShell>
  );
}
