"use client";

/**
 * MobileSidebar — slide-in nav drawer for the admin dashboard at < md.
 *
 * The desktop layout has a fixed `w-60` aside that's `hidden md:flex`.
 * This component fills the < md gap: a hamburger button sits in the
 * header, taps open a drawer that re-uses the same <SidebarNav /> +
 * Help link + <UserNav /> block from the desktop aside (passed in as
 * children so the dashboard layout owns the nav content and styling).
 *
 * Closes on:
 *   - backdrop tap
 *   - Escape key
 *   - route change (so following a nav link auto-dismisses the drawer)
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

export function MobileSidebar({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close on route change. The drawer's nav links are <Link>s, so
  // tapping one navigates without unmounting this component; we close
  // explicitly so the user lands on the new page with the drawer gone.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape key closes. Keep listener active only while open to avoid
  // adding handlers to every page in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock background scroll while the drawer is open so the body
  // doesn't scroll behind the overlay on phones.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="md:hidden p-2 -ml-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Backdrop */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-background/60 backdrop-blur-sm transition-opacity md:hidden ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Drawer */}
      <aside
        data-open={open}
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border/40 flex flex-col transition-transform md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-6 py-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              MinuteWise
            </h1>
            <p className="text-[11px] font-medium uppercase tracking-widest text-primary mt-0.5">
              Analytics Engine
            </p>
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="p-2 -mr-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}
