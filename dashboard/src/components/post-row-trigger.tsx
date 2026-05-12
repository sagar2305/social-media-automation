"use client";

/**
 * <PostRowTrigger postId="..."> — drop-in replacement for <TableRow> that
 * makes the entire post row clickable. Clicking anywhere inside the row
 * appends ?post=<id> to the URL so the universal <PostDrawerMount> renders
 * the detail drawer.
 *
 * Clicks on interactive descendants (the "View" external <a>, embedded
 * <button>s like the existing <PostTrigger> hook pill, form controls)
 * are skipped via target.closest() so they keep their original behaviour
 * — opening TikTok in a new tab still works without the drawer also
 * popping open behind it.
 *
 * Why a row-level component instead of wrapping each <TableRow> in
 * <PostTrigger>? <PostTrigger> renders a <button>, which is invalid HTML
 * inside a <table>. A <tr> with onClick is the correct DOM shape.
 */
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { TableRow } from "@/components/ui/table";

interface Props {
  postId: string;
  children: React.ReactNode;
  className?: string;
}

export function PostRowTrigger({ postId, children, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onClick(e: React.MouseEvent<HTMLTableRowElement>) {
    // Bail when the click came from an interactive descendant — the user
    // wants that element's behaviour (open TikTok, submit form, etc.),
    // not the drawer. closest() walks up the DOM from the actual target.
    const target = e.target as HTMLElement;
    if (target.closest("a, button, input, select, textarea, label")) return;

    const next = new URLSearchParams(searchParams.toString());
    next.set("post", postId);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <TableRow onClick={onClick} className={`cursor-pointer ${className ?? ""}`.trim()}>
      {children}
    </TableRow>
  );
}
