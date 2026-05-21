/**
 * Creator signup — defaults to the Sign Up tab of the unified auth form.
 * The shared component handles both tabs and routes between them.
 */

import { CreatorAuthForm } from "@/components/creator-auth-form";

export default function CreatorSignupPage() {
  return <CreatorAuthForm defaultTab="signup" />;
}
