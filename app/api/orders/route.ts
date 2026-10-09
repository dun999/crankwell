import { listTransactions } from "@/lib/server/commerce";
import { Session, handle, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const session = Session.parse(new URL(req.url).searchParams.get("session"));
    return json({ items: listTransactions(session) });
  });
}
