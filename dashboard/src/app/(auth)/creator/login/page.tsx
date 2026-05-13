"use client";

/**
 * Creator-portal login page. Visually distinct from the staff /login
 * (subtitle copy + signup link target) so a creator never wonders if
 * they're on the right URL.
 *
 * On successful sign-in, the auth callback decides where to land:
 *   - If their email matches a linked or matchable creator row →
 *     /creator (auto-promoted).
 *   - Otherwise → / (existing staff behaviour, harmless for a
 *     mismatched login attempt).
 *
 * Structure: the actual form lives in `<CreatorLoginForm>` so we can
 * wrap it in a Suspense boundary at the page level. `useSearchParams`
 * forces a CSR bailout at build time and Next refuses to prerender
 * the route without a Suspense parent — splitting the inner form out
 * keeps the page statically prerenderable.
 */

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function CreatorLoginPage() {
  return (
    <Suspense fallback={null}>
      <CreatorLoginForm />
    </Suspense>
  );
}

function CreatorLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createBrowserSupabase();
    const { error: err } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    // After password login, hit the linker server-side via /auth/relink
    // (a thin GET endpoint that mirrors the callback's link step). Then
    // route by role.
    router.push("/auth/relink");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm space-y-6 px-4">
      <div className="text-center">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 mb-3 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] uppercase tracking-widest font-semibold">
          Creator portal
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground mt-2">
          See your earnings and payment status
        </p>
      </div>
      <Link
        href="/welcome"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        ← Wrong portal? Back to chooser
      </Link>

      {reason === "unlinked" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs">
          Your account isn&apos;t linked to a creator profile yet. Ask your
          contact to invite the email you&apos;re using here.
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Email</label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Password</label>
              <Input
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-sm text-center text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/creator/signup" className="font-medium text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
