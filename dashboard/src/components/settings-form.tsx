"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Save, RotateCcw, Bell, Puzzle, Shield } from "lucide-react";

interface Props {
  userId: string;
  email: string;
  displayName: string;
  bio: string;
  role: string;
  systemUpdates: boolean;
  contentInsights: boolean;
  teamActivity: boolean;
}

export function SettingsForm({
  userId,
  email,
  displayName: initialName,
  bio: initialBio,
  role,
  systemUpdates: initialSU,
  contentInsights: initialCI,
  teamActivity: initialTA,
}: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialName);
  const [bio, setBio] = useState(initialBio);
  const [systemUpdates, setSystemUpdates] = useState(initialSU);
  const [contentInsights, setContentInsights] = useState(initialCI);
  const [teamActivity, setTeamActivity] = useState(initialTA);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    const supabase = createBrowserSupabase();

    await Promise.all([
      supabase
        .from("profiles")
        .update({ display_name: displayName, bio })
        .eq("id", userId),
      supabase.from("notification_prefs").upsert({
        id: userId,
        system_updates: systemUpdates,
        content_insights: contentInsights,
        team_activity: teamActivity,
        updated_at: new Date().toISOString(),
      }),
    ]);

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  function handleReset() {
    setDisplayName(initialName);
    setBio(initialBio);
    setSystemUpdates(initialSU);
    setContentInsights(initialCI);
    setTeamActivity(initialTA);
  }

  const roleBadge =
    role === "admin"
      ? "Admin"
      : role === "editor"
        ? "Editor"
        : "Viewer";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">
            Manage your account preferences and system configurations.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="h-4 w-4 mr-1.5" />
            Reset Defaults
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1.5" />
            {saving ? "Saving…" : saved ? "Saved!" : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* Profile + Plan */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Profile Card */}
        <Card className="lg:col-span-2 shadow-sm border-0 ring-0">
          <CardContent className="pt-6 space-y-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                  {(displayName || email || "A").charAt(0).toUpperCase()}
                </div>
              </div>
              <div>
                <p className="text-lg font-semibold">Editorial Profile</p>
                <p className="text-sm text-muted-foreground">
                  Update your public presence and curator credentials.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                  Display Name
                </label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="bg-muted/40 border-border/50"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                  Email Address
                </label>
                <Input
                  value={email}
                  disabled
                  className="bg-muted/40 border-border/50 opacity-60"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                Professional Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell us about yourself and your role..."
                rows={3}
                className="flex w-full rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 resize-y"
              />
            </div>
          </CardContent>
        </Card>

        {/* Plan Card */}
        <Card className="shadow-sm border-0 ring-0 bg-primary text-primary-foreground overflow-hidden">
          <CardContent className="pt-6 flex flex-col h-full">
            <div className="mb-4">
              <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center mb-4">
                <Shield className="h-5 w-5" />
              </div>
              <p className="text-xl font-bold">
                {roleBadge} Plan
              </p>
              <p className="text-sm text-primary-foreground/70 mt-1">
                Your current role is {roleBadge.toLowerCase()}.
                {role === "admin" && " Full access to all features."}
                {role === "editor" && " Can edit content and campaigns."}
                {role === "viewer" && " Read-only access to dashboards."}
              </p>
            </div>
            <div className="mt-auto pt-6">
              <Button
                variant="outline"
                className="w-full bg-white text-primary hover:bg-white/90 border-0"
              >
                Upgrade Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Notifications + Integrations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Notification Alerts */}
        <Card className="shadow-sm border-0 ring-0">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-6">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <p className="text-lg font-semibold">Notification Alerts</p>
            </div>

            <div className="space-y-5">
              <ToggleRow
                label="System Updates"
                description="Get notified about core engine changes."
                checked={systemUpdates}
                onChange={setSystemUpdates}
              />
              <ToggleRow
                label="Content Insights"
                description="Weekly summaries of your video performance."
                checked={contentInsights}
                onChange={setContentInsights}
              />
              <ToggleRow
                label="Team Activity"
                description="When teammates leave comments or tags."
                checked={teamActivity}
                onChange={setTeamActivity}
              />
            </div>
          </CardContent>
        </Card>

        {/* Connect Workflow */}
        <Card className="shadow-sm border-0 ring-0">
          <CardContent className="pt-6 flex flex-col items-center text-center">
            <div className="h-14 w-14 rounded-xl bg-muted flex items-center justify-center mb-4">
              <Puzzle className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold">Connect Your Workflow</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-xs">
              Integrate MinuteWise with Slack, Notion, or Zapier to
              automate your content curation pipeline.
            </p>
            <Button className="mt-6 bg-purple-600 hover:bg-purple-700 text-white">
              Browse Integrations
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform mt-0.5 ${
            checked ? "translate-x-5 ml-0.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
