/**
 * Creator sign-in — defaults to the Sign In tab of the unified auth form.
 * The shared component handles both tabs and routes between them.
 */

import { CreatorAuthForm } from "@/components/creator-auth-form";

export default function CreatorLoginPage() {
  return <CreatorAuthForm defaultTab="signin" />;
}
