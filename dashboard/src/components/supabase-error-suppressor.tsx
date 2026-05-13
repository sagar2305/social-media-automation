"use client";

/**
 * Silences the one specific browser-side error that Supabase's auth
 * lock throws by design when a newer token-refresh request preempts
 * an in-flight one:
 *
 *   "Lock 'lock:sb-<projectref>-auth-token' was released because
 *    another request stole it"
 *
 * Per Supabase's own docs and several pinned GitHub issues
 * (supabase/auth-js#872, #845), this rejection is *informational* —
 * the new request succeeds, the old one is intentionally cancelled.
 * It only ever surfaces as an "error" because the rejection isn't
 * caught anywhere by the SDK's internal call sites, so Next.js's
 * dev overlay picks it up.
 *
 * We don't suppress any other Supabase or Next error — just this
 * exact message. The match is narrow on purpose so real bugs still
 * show through.
 *
 * Mount once near the root of any layout that uses the browser
 * Supabase client. Returns null — pure side-effect component.
 */

import { useEffect } from "react";

const STOLEN_LOCK_SIGNATURE = "was released because another request stole it";

function isStolenLock(reason: unknown): boolean {
  if (!reason) return false;
  // Accept both Error instances and plain { message } objects — the
  // shape varies by where in the SDK the rejection originates.
  const msg =
    typeof reason === "string"
      ? reason
      : reason instanceof Error
        ? reason.message
        : typeof (reason as { message?: unknown }).message === "string"
          ? (reason as { message: string }).message
          : "";
  return msg.includes(STOLEN_LOCK_SIGNATURE);
}

export function SupabaseErrorSuppressor() {
  useEffect(() => {
    function onRejection(e: PromiseRejectionEvent) {
      if (isStolenLock(e.reason)) {
        e.preventDefault();
      }
    }
    function onError(e: ErrorEvent) {
      // Some bundlers/dev overlays surface unhandled rejections as
      // window.error too — cover both paths defensively.
      if (isStolenLock(e.error) || isStolenLock(e.message)) {
        e.preventDefault();
      }
    }
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
