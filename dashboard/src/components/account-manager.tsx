"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Plus, Trash2, Power, X } from "lucide-react";

export interface ManagedAccount {
  id: string;
  name: string;
  handle: string;
  active: boolean;
  notes: string | null;
}

export function AccountManager({
  initial,
  isAdmin,
}: {
  initial: ManagedAccount[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ManagedAccount[]>(initial);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newHandle, setNewHandle] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const activeCount = accounts.filter((a) => a.active).length;

  function resetForm() {
    setNewId("");
    setNewName("");
    setNewHandle("");
    setNewNotes("");
    setError(null);
  }

  async function handleAdd() {
    setError(null);
    if (!newId.trim() || !newName.trim() || !newHandle.trim()) {
      setError("Blotato ID, name, and handle are all required.");
      return;
    }
    const cleanHandle = newHandle.trim().replace(/^@/, "");
    const cleanName = newName.trim().startsWith("@") ? newName.trim() : `@${newHandle.trim().replace(/^@/, "")}`;

    setBusy(true);
    const supabase = createBrowserSupabase();
    const { data, error: err } = await supabase
      .from("accounts")
      .insert({
        id: newId.trim(),
        name: cleanName,
        handle: cleanHandle,
        notes: newNotes.trim() || null,
        active: true,
      })
      .select()
      .single<ManagedAccount>();

    setBusy(false);
    if (err || !data) {
      setError(err?.message ?? "Insert failed");
      return;
    }

    setAccounts((prev) => [...prev, data]);
    resetForm();
    setShowForm(false);
    router.refresh();
  }

  async function handleToggle(id: string, currentActive: boolean) {
    setBusy(true);
    const supabase = createBrowserSupabase();
    const { error: err } = await supabase
      .from("accounts")
      .update({ active: !currentActive, updated_at: new Date().toISOString() })
      .eq("id", id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, active: !currentActive } : a))
    );
    router.refresh();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete account ${name}?\n\nThis removes it from the cycle. Existing posts/analytics for this account stay in place.`)) return;
    setBusy(true);
    const supabase = createBrowserSupabase();
    const { error: err } = await supabase.from("accounts").delete().eq("id", id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    router.refresh();
  }

  return (
    <Card className="shadow-sm border-0 ring-0">
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold">Managed Accounts</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {activeCount} active · {accounts.length} total · used by every cycle run
            </p>
          </div>
          {isAdmin && !showForm && (
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Account
            </Button>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {showForm && isAdmin && (
          <Card className="bg-muted/30 border-border/50">
            <CardContent className="pt-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Blotato Account ID" hint="From my.blotato.com — e.g. 37043 or cmm…">
                  <Input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="37043" />
                </Field>
                <Field label="TikTok Handle" hint="Without the @ prefix">
                  <Input value={newHandle} onChange={(e) => setNewHandle(e.target.value)} placeholder="yournotetaker" />
                </Field>
                <Field label="Display Name" hint="Defaults to @handle if blank">
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="@yournotetaker" />
                </Field>
                <Field label="Notes (optional)" hint="Internal — not used by the pipeline">
                  <Input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="" />
                </Field>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={handleAdd} disabled={busy}>
                  {busy ? "Adding…" : "Add Account"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Handle</TableHead>
              <TableHead>Display Name</TableHead>
              <TableHead>Blotato ID</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="text-right">Active</TableHead>
              {isAdmin && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 && (
              <TableRow>
                <TableCell colSpan={isAdmin ? 6 : 5} className="text-center text-muted-foreground py-6">
                  No managed accounts yet. Click <strong>Add Account</strong> to start.
                </TableCell>
              </TableRow>
            )}
            {accounts.map((a) => (
              <TableRow key={a.id} className={a.active ? "" : "opacity-60"}>
                <TableCell className="font-medium">@{a.handle}</TableCell>
                <TableCell className="text-muted-foreground">{a.name}</TableCell>
                <TableCell className="font-mono text-xs">{a.id}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{a.notes || "—"}</TableCell>
                <TableCell className="text-right">
                  {a.active ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      ACTIVE
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-muted-foreground">PAUSED</span>
                  )}
                </TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        variant="outline"
                        onClick={() => handleToggle(a.id, a.active)}
                        disabled={busy}
                        title={a.active ? "Pause (skip in cycles)" : "Resume"}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => handleDelete(a.id, a.name)}
                        disabled={busy}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {!isAdmin && (
          <p className="text-xs text-muted-foreground">
            Read-only: only admins can add, pause, or delete accounts.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
