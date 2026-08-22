import type { ReactNode } from "react";
import { CreddySectionNav } from "./creddy-section-nav";
import { LiveBlotatoSync } from "./live-blotato-sync";

export default function CreddyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <CreddySectionNav />
        <LiveBlotatoSync />
      </div>
      {children}
    </div>
  );
}
