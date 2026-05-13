"use server";

/**
 * Server action for changing the active campaign filter.
 *
 * Why a server action instead of `document.cookie = …; router.refresh()`:
 *
 *   1. Cookies set via the next/headers cookies() API are *immediately*
 *      visible to the server-side re-render — they're attached to the
 *      same request the action runs in.
 *
 *   2. revalidatePath("/", "layout") explicitly evicts the layout +
 *      every page below it from the Router Cache. router.refresh()
 *      doesn't always do this in Next.js 16 + Turbopack, which is
 *      why the old client-side flow needed a manual F5.
 *
 *   3. No risk of the "cookie was set but the GET that follows uses
 *      the old value" race condition that can happen with
 *      document.cookie + an immediate fetch in the same tick.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
// Import the cookie name from the read-side module instead of
// re-exporting it from here — "use server" files only allow async
// function exports, so the constant has to live elsewhere.
import { ACTIVE_CAMPAIGN_COOKIE } from "@/lib/campaign-filter";

export async function setActiveCampaign(slug: string | null): Promise<void> {
  const store = await cookies();
  if (slug && slug.trim()) {
    store.set(ACTIVE_CAMPAIGN_COOKIE, slug.trim(), {
      path: "/",
      // 30 days — long enough not to require re-picking after a coffee
      // break, short enough that an archived-campaign cookie doesn't
      // linger forever.
      maxAge: 30 * 86400,
      sameSite: "lax",
    });
  } else {
    store.delete(ACTIVE_CAMPAIGN_COOKIE);
  }
  // Invalidate every page below the root layout so the next render
  // re-reads the cookie. Wide hammer; cheap to swing.
  revalidatePath("/", "layout");
}
