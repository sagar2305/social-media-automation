"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { createCreator } from "../../payouts/actions";
import { createBrowserSupabase } from "@/lib/supabase-browser";

interface AccountOption {
  id: string;
  name: string;
  handle: string;
}

export function CreateCreatorForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state — uncontrolled would also work but the kind switch
  // changes copy elsewhere, so controlled is simpler.
  const [kind, setKind] = useState<"ugc" | "team_member">("ugc");
  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [processor, setProcessor] = useState<"manual" | "lumanu" | "stripe" | "wise">("manual");
  const [manualNotes, setManualNotes] = useState("");

  // Engine-managed accounts (only relevant when kind=team_member). Loaded
  // lazily on first switch to team_member so the UGC path stays cheap.
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [ownedAccountIds, setOwnedAccountIds] = useState<string[]>([]);

  useEffect(() => {
    if (kind !== "team_member" || accounts.length > 0 || accountsLoading) return;
    setAccountsLoading(true);
    const sb = createBrowserSupabase();
    sb.from("accounts")
      .select("id, name, handle")
      .eq("active", true)
      .order("name")
      .returns<AccountOption[]>()
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setAccounts(data ?? []);
        setAccountsLoading(false);
      });
  }, [kind, accounts.length, accountsLoading]);

  function toggleOwnedAccount(id: string) {
    setOwnedAccountIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const r = await createCreator({
      kind,
      legal_name: legalName,
      display_name: displayName || null,
      email,
      country: country || null,
      preferred_processor: processor,
      manual_payout_notes: manualNotes || null,
      // Only send when team_member — UGC path leaves it server-defaulted to [].
      owned_account_ids: kind === "team_member" ? ownedAccountIds : undefined,
    });
    setSubmitting(false);
    if (!r.ok) { setError(r.error); return; }
    router.push(`/creators/${r.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Link
        href="/creators"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to creators
      </Link>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <Card>
        <CardContent className="pt-6 space-y-5">
          <div>
            <p className="text-base font-semibold">Creator type</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              UGC = external content creator we pay per post. Team member =
              someone who owns one of our engine-managed accounts.
            </p>
          </div>
          <div className="flex gap-2">
            <KindButton active={kind === "ugc"} onClick={() => setKind("ugc")} title="UGC creator" subtitle="Posts content for your campaigns" />
            <KindButton active={kind === "team_member"} onClick={() => setKind("team_member")} title="Team member" subtitle="Owns an engine-managed account" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-5">
          <div>
            <p className="text-base font-semibold">Identity</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Legal name" required>
              <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Maya Chen" required />
            </Field>
            <Field label="Display name" hint="Optional — shown in the dashboard. No leading @, just the name.">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Maya" />
            </Field>
            <Field label="Email" required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maya@example.com" required />
            </Field>
            <Field label="Country" hint="ISO-3166 alpha-2 code (e.g. IN, US, GB)">
              <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="IN" />
            </Field>
          </div>
        </CardContent>
      </Card>

      {kind === "team_member" && (
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div>
              <p className="text-base font-semibold">Owned accounts</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Which engine-managed TikTok handles does this team member own?
                Posts published through these accounts are automatically
                attributed to them — no per-post tagging needed.
              </p>
            </div>

            {accountsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading accounts…
              </div>
            ) : accounts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No active accounts found. Add one in <Link href="/accounts" className="underline">/accounts</Link> first.
              </p>
            ) : (
              <div className="space-y-2">
                {accounts.map((a) => {
                  const checked = ownedAccountIds.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                        checked
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/40"
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
                        onChange={() => toggleOwnedAccount(a.id)}
                        className="h-4 w-4 accent-primary"
                      />
                    </label>
                  );
                })}
                <p className="text-[11px] text-muted-foreground">
                  {ownedAccountIds.length === 0
                    ? "No accounts selected — you can pick some now or leave blank and edit later."
                    : `${ownedAccountIds.length} account${ownedAccountIds.length === 1 ? "" : "s"} selected.`}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6 space-y-5">
          <div>
            <p className="text-base font-semibold">Payout method</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              How you pay this creator <strong>externally</strong>. The platform
              only calculates the amount — it doesn&apos;t move money. Use the
              notes field to remind yourself where to send the transfer.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Method">
              <Select value={processor} onValueChange={(v) => { if (v) setProcessor(v as typeof processor); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual (bank / UPI / external)</SelectItem>
                  <SelectItem value="lumanu" disabled>Lumanu (not yet integrated)</SelectItem>
                  <SelectItem value="stripe" disabled>Stripe Connect (not yet integrated)</SelectItem>
                  <SelectItem value="wise" disabled>Wise (not yet integrated)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div />
          </div>

          {processor === "manual" && (
            <Field label="Payout note" hint="Free-form reminder of how to pay this creator">
              <Input
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
                placeholder="UPI: maya@axisbank · or · Wise to USD acct ending 4582"
              />
            </Field>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Link href="/creators">
          <Button variant="outline" type="button">Cancel</Button>
        </Link>
        <Button type="submit" disabled={submitting || !legalName.trim() || !email.trim()}>
          {submitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
          Create creator
        </Button>
      </div>
    </form>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function KindButton({ active, onClick, title, subtitle }: { active: boolean; onClick: () => void; title: string; subtitle: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 text-left px-4 py-3 rounded-md border transition-colors ${
        active
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-muted/40"
      }`}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
    </button>
  );
}
