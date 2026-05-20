import { createClient } from "@/lib/supabase";
import { getUser } from "@/lib/auth";
import { SettingsForm } from "@/components/settings-form";

export const revalidate = 0;

export default async function SettingsPage() {
  // Auth first via shared helper to avoid token lock contention.
  const user = await getUser();
  const supabase = await createClient();

  let profile = null;
  let notifPrefs = null;
  let loadError: string | null = null;

  if (user) {
    const [profileRes, prefsRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("notification_prefs").select("*").eq("id", user.id).maybeSingle(),
    ]);
    if (profileRes.error || prefsRes.error) {
      loadError = profileRes.error?.message ?? prefsRes.error?.message ?? "Failed to load settings";
    } else {
      profile = profileRes.data;
      notifPrefs = prefsRes.data;
    }
  }

  if (loadError) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 text-destructive rounded-md p-4 text-sm">
        Failed to load settings: {loadError}
      </div>
    );
  }

  return (
    <SettingsForm
      userId={user?.id ?? ""}
      email={user?.email ?? ""}
      displayName={profile?.display_name ?? ""}
      bio={profile?.bio ?? ""}
      role={user?.role ?? "viewer"}
      systemUpdates={notifPrefs?.system_updates ?? true}
      contentInsights={notifPrefs?.content_insights ?? true}
      teamActivity={notifPrefs?.team_activity ?? false}
    />
  );
}
