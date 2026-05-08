/**
 * /campaigns/[slug]/posts — full posts table for one campaign.
 *
 * Mirrors the global /posts page but filtered to this campaign's
 * campaign_id. Click the hook pill to open the universal post drawer
 * (Phase 7) — the View column on the right still opens TikTok in a
 * new tab.
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExportButton } from "@/components/export-button";
import { PostTrigger } from "@/components/post-trigger";
import type { Campaign } from "@/lib/types";

export const revalidate = 60;

interface PostRow {
  id: string;
  date: string | null;
  hook_style: string | null;
  format: string | null;
  flow: string | null;
  account: string | null;
  views: number | null;
  likes: number | null;
  saves: number | null;
  save_rate: number | null;
  status: string | null;
  tiktok_url: string | null;
}

function StatusPill({ status }: { status: string | null }) {
  const label = status?.replace(/ \(.*\)/, "") || "unknown";
  const isPublished = status === "published";
  const isScheduled = status?.includes("scheduled");
  const isPending = status === "pending" || status === "in-progress";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isPublished
          ? "bg-[#248a3d]/10 text-[#248a3d]"
          : isScheduled
            ? "bg-[#bf4800]/10 text-[#bf4800]"
            : isPending
              ? "bg-[#0070f3]/10 text-[#0070f3]"
              : "bg-secondary text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}

export default async function CampaignPostsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle<Pick<Campaign, "id" | "name" | "slug">>();
  if (!campaign) notFound();

  const { data: postsData } = await sb
    .from("posts")
    .select(
      "id, date, hook_style, format, flow, account, views, likes, saves, save_rate, status, tiktok_url",
    )
    .eq("campaign_id", campaign.id)
    .order("date", { ascending: false });

  const allPosts: PostRow[] = (postsData ?? []) as PostRow[];
  const published = allPosts.filter((p) => p.status === "published").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {allPosts.length} post{allPosts.length === 1 ? "" : "s"} ·{" "}
          {published} published · {allPosts.length - published} drafts/failed
        </p>
        <ExportButton
          data={allPosts.map((p) => ({
            date: p.date ?? "",
            account: p.account ?? "",
            hook_style: p.hook_style ?? "",
            format: p.format ?? "",
            flow: p.flow ?? "",
            views: p.views ?? 0,
            likes: p.likes ?? 0,
            saves: p.saves ?? 0,
            save_rate: p.save_rate ?? 0,
            status: p.status ?? "",
            tiktok_url: p.tiktok_url ?? "",
          }))}
          filename={`${campaign.slug}-posts`}
          columns={[
            { key: "date", label: "Date" },
            { key: "account", label: "Account" },
            { key: "hook_style", label: "Hook Style" },
            { key: "format", label: "Format" },
            { key: "flow", label: "Flow" },
            { key: "views", label: "Views" },
            { key: "likes", label: "Likes" },
            { key: "saves", label: "Saves" },
            { key: "save_rate", label: "Save %" },
            { key: "status", label: "Status" },
            { key: "tiktok_url", label: "TikTok URL" },
          ]}
        />
      </div>

      {allPosts.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-base font-medium mb-1">No posts yet</p>
            <p className="text-sm text-muted-foreground">
              Posts created by the cycle will show up here once this campaign
              starts running.
            </p>
          </CardContent>
        </Card>
      )}

      {allPosts.length > 0 && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-sm font-medium">Date</TableHead>
                  <TableHead className="text-sm font-medium">Hook</TableHead>
                  <TableHead className="text-sm font-medium">Format</TableHead>
                  <TableHead className="text-sm font-medium">Flow</TableHead>
                  <TableHead className="text-sm font-medium text-right">Views</TableHead>
                  <TableHead className="text-sm font-medium text-right">Likes</TableHead>
                  <TableHead className="text-sm font-medium text-right">Saves</TableHead>
                  <TableHead className="text-sm font-medium text-right">Save %</TableHead>
                  <TableHead className="text-sm font-medium">Status</TableHead>
                  <TableHead className="text-sm font-medium">Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allPosts.map((post) => (
                  <TableRow key={post.id}>
                    <TableCell className="whitespace-nowrap tabular-nums text-sm">
                      <div>{post.date}</div>
                      {post.account && (
                        <div className="text-xs text-muted-foreground/60 mt-0.5">
                          @{post.account}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <PostTrigger
                        postId={post.id}
                        className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-sm font-medium hover:bg-secondary/80"
                      >
                        {post.hook_style ?? "—"}
                      </PostTrigger>
                    </TableCell>
                    <TableCell className="text-sm">{post.format ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {post.flow ?? "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {post.views && post.views > 0 ? (
                        <span className="font-semibold">
                          {post.views.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {post.likes && post.likes > 0 ? (
                        <span className="font-semibold">
                          {post.likes.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {post.saves && post.saves > 0 ? (
                        <span className="font-semibold">
                          {post.saves.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {post.save_rate && post.save_rate > 0 ? (
                        <span className="font-semibold">{post.save_rate}%</span>
                      ) : (
                        <span className="text-muted-foreground/30">0%</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={post.status} />
                    </TableCell>
                    <TableCell>
                      {post.tiktok_url && post.tiktok_url !== "-" ? (
                        // No onClick={stopPropagation} here — server components
                        // can't ship event handlers to the browser. The row
                        // itself has no click handler, so bubbling is moot.
                        <a
                          href={post.tiktok_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-[#16a34a] hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
