import { sha256 } from "./_shared.js";

const TRANSACTION_LIFETIME_MS = 15 * 60 * 1000;

async function ensureTransactionStore(env) {
  if (!env.DB) throw new Error("The Head Office database is not connected.");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS microsoft_oidc_transactions (
    state_hash TEXT PRIMARY KEY,
    transaction_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
}

export async function storeMicrosoftTransaction(env, state, transactionToken) {
  const cleanState = String(state || "").trim();
  const cleanToken = String(transactionToken || "").trim();
  if (!cleanState || !cleanToken) throw new Error("The Microsoft sign-in transaction could not be prepared.");

  await ensureTransactionStore(env);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM microsoft_oidc_transactions WHERE expires_at<=?").bind(now),
    env.DB.prepare(`INSERT INTO microsoft_oidc_transactions
      (state_hash,transaction_token,expires_at,created_at)
      VALUES (?,?,?,?)
      ON CONFLICT(state_hash) DO UPDATE SET
        transaction_token=excluded.transaction_token,
        expires_at=excluded.expires_at,
        created_at=excluded.created_at`)
      .bind(await sha256(cleanState), cleanToken, now + TRANSACTION_LIFETIME_MS, new Date(now).toISOString())
  ]);
}

export async function consumeMicrosoftTransaction(env, state) {
  const cleanState = String(state || "").trim();
  if (!cleanState || !env.DB) return "";

  await ensureTransactionStore(env);
  const stateHash = await sha256(cleanState);
  const row = await env.DB.prepare(`SELECT transaction_token,expires_at
    FROM microsoft_oidc_transactions
    WHERE state_hash=? LIMIT 1`).bind(stateHash).first();

  if (!row) return "";
  await env.DB.prepare("DELETE FROM microsoft_oidc_transactions WHERE state_hash=?").bind(stateHash).run();
  if (Number(row.expires_at || 0) <= Date.now()) return "";
  return String(row.transaction_token || "");
}
