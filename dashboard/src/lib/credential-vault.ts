/**
 * Symmetric vault for sensitive operational secrets we have to
 * hold on behalf of creators — currently only TikTok passwords
 * collected through the "Add your own account" flow in /creator.
 *
 * Design:
 *   - AES-256-GCM (authenticated encryption) using Node's stdlib
 *     `crypto`. Functionally equivalent to pgcrypto's pgp_sym_encrypt
 *     for at-rest protection; chosen over pgcrypto because the key
 *     stays in Vercel-encrypted env (`CREDENTIAL_VAULT_KEY`) rather
 *     than in Postgres settings, and we avoid round-tripping
 *     plaintext through SQL.
 *
 *   - Storage format: base64( iv || authTag || ciphertext ).
 *     12-byte IV (GCM standard), 16-byte tag, opaque ct. The DB
 *     column is plain `text` — easy to reason about, easy to clear
 *     with a NULL update, easy to spot-check that we never wrote
 *     plaintext.
 *
 *   - Key handling: the env value is treated as material (any
 *     length, any charset); we derive a stable 32-byte key from it
 *     via scrypt with a fixed app-scoped salt. That lets us accept
 *     human-friendly secrets (e.g. a long random string from
 *     `openssl rand -base64 48`) without forcing exact lengths.
 *
 * Threat model: a DB-only leak (Supabase service_role key,
 * accidental dump, SQL injection on a select) yields ciphertext
 * only — the attacker would also need the env key to recover
 * plaintext. A full server compromise (env + DB) loses both,
 * which is unavoidable for any "hot" credential the app uses.
 *
 * Operational notes:
 *   - Decrypt failures throw — callers (admin reveal action,
 *     mainly) should catch and surface a benign "couldn't decrypt
 *     (key rotated?)" error rather than leaking the throw upstream.
 *   - Rotating the key after we've stored ciphertext makes existing
 *     rows un-decryptable. There's no migration path baked in
 *     because the wipe-on-approve + 7-day TTL means stored rows
 *     turn over quickly; a deferred key rotation just means the
 *     next creator's submission uses the new key.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KDF_SALT = "minutewise.credential-vault.v1";

let cachedKey: Buffer | null = null;

/**
 * Derive the AES key from CREDENTIAL_VAULT_KEY. Cached after first
 * use because scrypt is intentionally slow (~50ms) and we don't
 * want to pay it on every encrypt/decrypt. Re-deriving when the
 * env var changes requires a server restart, which is fine.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.CREDENTIAL_VAULT_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      "CREDENTIAL_VAULT_KEY is missing or too short. Generate one with " +
      "`openssl rand -base64 48` and set it in .env.local (and Vercel project env).",
    );
  }
  cachedKey = scryptSync(raw, KDF_SALT, KEY_BYTES);
  return cachedKey;
}

/**
 * Encrypt a UTF-8 plaintext (e.g. a TikTok password) for at-rest
 * storage. Returns the storable string. Re-encrypting the same
 * plaintext yields a different ciphertext each call (fresh IV) —
 * intentional, prevents an admin browsing the DB from spotting
 * "these two creators have the same password".
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) throw new Error("Cannot encrypt an empty secret.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Reverse of encryptSecret. Throws on tampering (GCM auth tag
 * mismatch), missing key, or malformed input — callers should
 * treat any throw as "we cannot recover this secret".
 */
export function decryptSecret(stored: string): string {
  if (!stored) throw new Error("Cannot decrypt an empty value.");
  const buf = Buffer.from(stored, "base64");
  if (buf.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("Stored secret is malformed (too short).");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
