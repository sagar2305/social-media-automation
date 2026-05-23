import { requireRole } from "@/lib/auth";
import { getPageContentForEditor } from "@/lib/cms";
import { TiktokSetupEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function SignupControlTiktokSetupPage() {
  await requireRole("admin");
  const { content, updatedAt } = await getPageContentForEditor("tiktok-setup");
  return <TiktokSetupEditor initial={content} updatedAt={updatedAt} />;
}
