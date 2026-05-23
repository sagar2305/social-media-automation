/**
 * /creator/brief — long-scroll internship brief.
 *
 * Thin server-component shell. All content (headings, body, video, FAQ,
 * journey, etc. — including per-text styling) is fetched from the CMS
 * (public.cms_pages, slug "brief") and passed to BriefView. Admins
 * edit everything via /signup-control/brief.
 */

import { getPageContent } from "@/lib/cms";
import { BriefView } from "./view";

export const dynamic = "force-dynamic";

export default async function CreatorBriefPage() {
  const content = await getPageContent("brief");
  return <BriefView content={content} />;
}
