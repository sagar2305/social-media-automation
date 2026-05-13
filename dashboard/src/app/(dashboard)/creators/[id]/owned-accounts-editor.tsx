"use client";

/**
 * Inline editor for `creators.owned_account_ids` — only rendered on
 * team_member creator profiles. Lets the operator change which
 * engine-managed accounts the team member owns after invite, since
 * ownership often shifts (handle handover, new account added, etc).
 *
 * Mirrors the picker on /creators/new and saves via updateCreator.
 * Auto-fetches active accounts on mount; cheap (4 rows in practice).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Save, X } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { updateCreator } from "../../payouts/actions";

interface AccountOption {
  id: string;
  name: string;
  handle: string;
}

interface Props {
  creatorId: string;
  initialOwnedIds: string[];
}

export function OwnedAccountsEditor({ creatorId, initialOwnedIds }: Props) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>(initialOwnedIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    const sb = createBrowserSupabase();
    sb.from("accounts")
      .select("id, name, handle")
      .eq("active", true)
      .order("name")
      .returns<AccountOption[]>()
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setAccounts(data ?? []);
        setLoading(false);
      });
  }, []);

  // Whether the current selection differs from the saved baseline —
  // drives the Save button's enabled state and the "unsaved" hint.
  const sortedA = [...selected].sort();
  const sortedB = [...initialOwnedIds].sort();
  const dirty = sortedA.length !== sortedB.length || sortedA.some((v, i) => v !== sortedB[i]);

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    const r = await updateCreator({ id: creatorId, owned_account_ids: selected });
    setSaving(false);
    if (!r.ok) { setError(r.error); return; }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-base font-semibold">Owned accounts</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Posts on these handles are auto-attributed to this team member.
            </p>
          </div>
          {savedFlash && (
            <span className="text-xs text-emerald-600 font-medium">Saved ✓</span>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading accounts…
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No active accounts. Add one in /accounts first.
          </p>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => {
              const checked = selected.includes(a.id);
              return (
                <label
                  key={a.id}
                  className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                    checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">@{a.handle}</p>
                    {a.name !== `@${a.handle}` && (
                      <p className="text-xs text-muted-foreground">{a.name}</p>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(a.id)}
                    className="h-4 w-4 accent-primary"
                  />
                </label>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border/60">
          <p className="text-[11px] text-muted-foreground">
            {dirty
              ? `${selected.length} selected · unsaved changes`
              : `${selected.length} selected`}
          </p>
          <Button type="button" onClick={onSave} disabled={!dirty || saving} size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
