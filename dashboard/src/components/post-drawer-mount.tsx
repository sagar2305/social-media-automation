"use client";

/**
 * Top-level mount that wires the universal post detail drawer to the URL.
 *
 * Pattern: any component anywhere in the dashboard can trigger the
 * drawer by appending ?post=<id> to the current URL (use <PostTrigger />
 * or buildPostHref() for the link). This component reads the param,
 * renders <PostDetailDrawer /> when present, and removes the param on
 * close so the URL stays clean.
 *
 * Mounted once from (dashboard)/layout.tsx so every dashboard route
 * shares one drawer instance.
 */

import { useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { PostDetailDrawer } from "./post-detail-drawer";

export function PostDrawerMount() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const postId = searchParams.get("post");

  const onClose = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("post");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  if (!postId) return null;
  return <PostDetailDrawer postId={postId} onClose={onClose} />;
}
