import "server-only";
import type { WalletInfo } from "@/lib/commerce/types";
import { db } from "./db";
import * as pp from "./paypal";

// One saved PayPal wallet (Vault payment token) per browser session, used for one-tap checkout.

interface WalletRow {
  session_id: string;
  vault_id: string;
  customer_id: string | null;
  payer_email: string | null;
  ship_to: string | null;
  created_at: string;
}

const getRow = (sessionId: string) => db().prepare("SELECT * FROM wallets WHERE session_id = ?").get(sessionId) as WalletRow | undefined;

/** The vault token to charge for one-tap, if this session saved PayPal. */
export function walletVaultId(sessionId: string): string | undefined {
  return getRow(sessionId)?.vault_id;
}

/** Where one-tap parts ship: the address from the PayPal approval that saved the wallet. */
export function walletShipTo(sessionId: string): pp.ShipTo | undefined {
  const raw = getRow(sessionId)?.ship_to;
  return raw ? (JSON.parse(raw) as pp.ShipTo) : undefined;
}

/** Remember the buyer's PayPal ship-to for later one-tap orders (they have no PayPal page to pick one). */
export function rememberShipTo(sessionId: string, shipTo: pp.ShipTo) {
  db().prepare("UPDATE wallets SET ship_to = ? WHERE session_id = ?").run(JSON.stringify(shipTo), sessionId);
}

export function walletInfo(sessionId: string): WalletInfo | null {
  const r = getRow(sessionId);
  return r ? { email: r.payer_email ?? undefined, savedAt: r.created_at } : null;
}

/** Store a token PayPal reports as VAULTED (capture response or VAULT.PAYMENT-TOKEN.CREATED). */
export function saveWallet(sessionId: string, vault: pp.VaultInfo, email?: string) {
  db()
    .prepare(
      `INSERT INTO wallets (session_id, vault_id, customer_id, payer_email, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET vault_id = excluded.vault_id, customer_id = excluded.customer_id,
         payer_email = COALESCE(excluded.payer_email, wallets.payer_email)`,
    )
    .run(sessionId, vault.id, vault.customerId ?? null, email ?? null, new Date().toISOString());
}

/** Forget the saved wallet here and delete the token at PayPal. */
export async function removeWallet(sessionId: string) {
  const r = getRow(sessionId);
  if (!r) return;
  // Already gone at PayPal (or revoked by the buyer) counts as removed, so it's forgotten here too.
  await pp.deletePaymentToken(r.vault_id);
  db().prepare("DELETE FROM wallets WHERE session_id = ?").run(sessionId);
}

/** VAULT.PAYMENT-TOKEN.DELETED: the buyer removed us from their PayPal account. */
export function forgetVaultToken(vaultId: string) {
  return db().prepare("DELETE FROM wallets WHERE vault_id = ?").run(vaultId).changes > 0;
}
