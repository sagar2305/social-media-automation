"use client";

/**
 * Creator-portal signup. Mirrors the staff /signup form but explains
 * the precondition: the operator must have invited this email first
 * (a `creators.email` row exists). Otherwise the post-signup linker
 * silently leaves them as a 'viewer' with no portal access.
 */

import { useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function CreatorSignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = createBrowserSupabase();
    // Pass the email through emailRedirectTo so the confirmation link
    // lands at /auth/callback, where the linker fires.
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });

    if (err) {
      setError(err.message);
    } else {
      setSuccess(true);
    }
    setLoading(false);
  }

  if (success) {
    return (
      <div className="w-full max-w-sm px-4 text-center space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-muted-foreground">
          We sent a confirmation link to <strong>{email}</strong>. Click the link
          to activate your account, and you&apos;ll be sent to your creator
          dashboard automatically.
        </p>
        <Link href="/creator/login" className="text-sm font-medium text-primary hover:underline">
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6 px-4">
      <div className="text-center">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 mb-3 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] uppercase tracking-widest font-semibold">
          Creator portal
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-muted-foreground mt-2">It takes about 30 seconds.</p>
      </div>
      <Link
        href="/welcome"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        ← Wrong portal? Back to chooser
      </Link>

      <div className="rounded-md border border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 px-3 py-2 text-xs">
        Use the email your contact invited you with — otherwise the portal
        won&apos;t have a creator profile to attach to.
      </div>

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
                placeholder="Min 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Confirm password</label>
              <Input
                type="password"
                placeholder="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating account…" : "Sign up"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-sm text-center text-muted-foreground">
        Already have an account?{" "}
        <Link href="/creator/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
