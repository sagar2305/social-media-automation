"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Copy, Check } from "lucide-react";

interface ShareLink {
  id: string;
  token: string;
  title: string;
  accounts: string[] | null;
  expires_at: string | null;
  created_at: string;
}

export function ShareLinksTable({ links }: { links: ShareLink[] }) {
  const router = useRouter();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  function getShareUrl(token: string) {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/share/${token}`;
    }
    return `/share/${token}`;
  }

  async function handleCopy(token: string, id: string) {
    await navigator.clipboard.writeText(getShareUrl(token));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    const supabase = createBrowserSupabase();
    await supabase.from("share_links").delete().eq("id", id);
    router.refresh();
    setDeleting(null);
  }

  if (links.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-8">
        No share links yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Accounts</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {links.map((link) => {
          const expired =
            link.expires_at && new Date(link.expires_at) < new Date();
          return (
            <TableRow key={link.id}>
              <TableCell className="font-medium">{link.title}</TableCell>
              <TableCell className="text-muted-foreground">
                {link.accounts?.length
                  ? link.accounts.map((a) => `@${a}`).join(", ")
                  : "All"}
              </TableCell>
              <TableCell>
                {link.expires_at ? (
                  <Badge
                    variant={expired ? "destructive" : "secondary"}
                  >
                    {expired ? "Expired" : new Date(link.expires_at).toLocaleDateString()}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">Never</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {new Date(link.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleCopy(link.token, link.id)}
                    title="Copy link"
                  >
                    {copiedId === link.id ? (
                      <Check className="h-3.5 w-3.5 text-[#248a3d]" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDelete(link.id)}
                    disabled={deleting === link.id}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
