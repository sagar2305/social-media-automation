import { requireRole } from "@/lib/auth";
import { getPageContentForEditor } from "@/lib/cms";
import { BriefEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function SignupControlBriefPage() {
  await requireRole("admin");
  const { content, updatedAt } = await getPageContentForEditor("brief");
  return <BriefEditor initial={content} updatedAt={updatedAt} />;
}
