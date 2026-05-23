import { requireRole } from "@/lib/auth";
import { getPageContentForEditor } from "@/lib/cms";
import { AuthFormEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function SignupControlAuthFormPage() {
  await requireRole("admin");
  const { content, updatedAt } = await getPageContentForEditor("auth-form");
  return <AuthFormEditor initial={content} updatedAt={updatedAt} />;
}
