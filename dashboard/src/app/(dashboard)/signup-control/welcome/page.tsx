import { requireRole } from "@/lib/auth";
import { getPageContentForEditor } from "@/lib/cms";
import { WelcomeEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function SignupControlWelcomePage() {
  await requireRole("admin");
  const { content, updatedAt } = await getPageContentForEditor("welcome");
  return <WelcomeEditor initial={content} updatedAt={updatedAt} />;
}
