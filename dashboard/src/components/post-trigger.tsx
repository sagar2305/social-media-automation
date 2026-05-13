"use client";

/**
 * <PostTrigger postId="..."> — wraps any element so clicking it opens
 * the universal post detail drawer for that post id.
 *
 * Implementation: appends ?post=<id> to the current URL via router.push,
 * preserving every other query param. The PostDrawerMount component
 * (mounted once in the dashboard layout) listens for ?post= and renders
 * the drawer.
 *
 * Why not a plain <Link>? next/link triggers a full RSC fetch on every
 * navigation, which on a slow connection looks like the drawer "lags"
 * behind the click. router.push with shallow updates feels instant
 * because the page itself doesn't change.
 *
 * Two flavours:
 *   - <PostTrigger postId>{children}</PostTrigger>  → renders a <button>
 *     that fills its parent, suitable for wrapping a card body
 *   - buildPostHref(currentSearch, postId) → href string for <a>/<Link>
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  postId: string;
  children: React.ReactNode;
}

export function PostTrigger({ postId, children, className, onClick, ...rest }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handle(e: React.MouseEvent<HTMLButtonElement>) {
    onClick?.(e);
    if (e.defaultPrevented) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("post", postId);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <button
      type="button"
      onClick={handle}
      className={className}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Build an href that will open the drawer for the given post when clicked. */
export function buildPostHref(
  pathname: string,
  searchParams: URLSearchParams,
  postId: string,
): string {
  const next = new URLSearchParams(searchParams.toString());
  next.set("post", postId);
  return `${pathname}?${next.toString()}`;
}
