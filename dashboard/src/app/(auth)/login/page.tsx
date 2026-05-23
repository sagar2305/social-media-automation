"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
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
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6 px-4">
      <div className="space-y-6">
        <div className="text-center space-y-3">
          {/* Brewapps logo, centered above the heading — mirrors the
              /welcome/campaign and creator auth form pattern so every
              entry point has a consistent brand mark. */}
          <Image
            src="/brewapps-logo.png"
            alt="Brewapps"
            width={144}
            height={144}
            priority
            className="h-14 sm:h-16 w-auto mx-auto"
          />
          {/* Admin-context badge: makes it unambiguous this is the
              internal staff portal, not the creator one. */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] uppercase tracking-widest font-semibold">
            <ShieldCheck className="h-3 w-3" />
            Admin
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Admin sign in
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to manage campaigns, creators, and payouts.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Email
                </label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Password
                </label>
                <Input
                  type="password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-sm text-center text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary hover:underline"
          >
            Sign up
          </Link>
        </p>

        {/* "Back to portal chooser" — centered, primary-tinted, same
            treatment as the creator-side chooser page so the two
            entry surfaces feel consistent. */}
        <p className="text-center text-xs text-muted-foreground">
          <Link
            href="/welcome"
            className="text-primary hover:underline"
          >
            ← Wrong portal? Back to chooser
          </Link>
        </p>
      </div>
    </div>
  );
}

