import { listTransactions } from "@/lib/server/commerce";
import { handle, json, requireSession } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => json({ items: listTransactions(requireSession(req)) }));
}
