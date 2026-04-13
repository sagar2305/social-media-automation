import { createClient } from "@/lib/supabase";
import { SettingsForm } from "@/components/settings-form";

export const revalidate = 0;

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile = null;
  let notifPrefs = null;

  if (user) {
    const [profileRes, prefsRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("notification_prefs").select("*").eq("id", user.id).single(),
    ]);
    profile = profileRes.data;
    notifPrefs = prefsRes.data;
  }

  return (
    <SettingsForm
      userId={user?.id ?? ""}
      email={user?.email ?? ""}
      displayName={profile?.display_name ?? ""}
      bio={profile?.bio ?? ""}
      role={profile?.role ?? "viewer"}
      systemUpdates={notifPrefs?.system_updates ?? true}
      contentInsights={notifPrefs?.content_insights ?? true}
      teamActivity={notifPrefs?.team_activity ?? false}
    />
  );
}
