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
import { PostRowTrigger } from "@/components/post-row-trigger";
import { getActiveCampaignFilter } from "@/lib/campaign-filter";

export const revalidate = 300;

export default async function PostsPage() {
  const supabase = await createClient();
  const activeCampaign = await getActiveCampaignFilter();

  let postsQuery = supabase
    .from("posts")
    .select("*")
    .order("date", { ascending: false });
  if (activeCampaign) postsQuery = postsQuery.eq("campaign_id", activeCampaign.id);

  const { data: posts } = await postsQuery;
  const allPosts = posts ?? [];
  const published = allPosts.filter((p) => p.status === "published").length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-5xl font-semibold tracking-tight">Posts</h1>
          <p className="text-lg text-muted-foreground mt-2">
            {activeCampaign ? (
              <>
                Posts in{" "}
                <span className="text-foreground font-medium">{activeCampaign.name}</span>
                {" "}— sorted by date.
              </>
            ) : (
              "All posts sorted by date."
            )}
          </p>
        </div>
        <div className="flex items-center gap-6">
          <ExportButton
            data={allPosts.map((p) => ({
              date: p.date,
              account: p.account,
              hook_style: p.hook_style,
              format: p.format,
              flow: p.flow,
              views: p.views,
              likes: p.likes,
              saves: p.saves,
              save_rate: p.save_rate,
              status: p.status,
              tiktok_url: p.tiktok_url,
            }))}
            filename="posts"
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
          <div className="flex gap-6 tabular-nums text-sm">
            <div className="text-right">
              <p className="text-2xl font-semibold">{allPosts.length}</p>
              <p className="text-muted-foreground">Total</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold">{published}</p>
              <p className="text-muted-foreground">Published</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold text-muted-foreground/50">
                {allPosts.length - published}
              </p>
              <p className="text-muted-foreground">Drafts</p>
            </div>
          </div>
        </div>
      </div>

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
                <PostRowTrigger key={post.id} postId={post.id}>
                  <TableCell className="whitespace-nowrap tabular-nums text-sm">
                    <div>{post.date}</div>
                    {post.account && (
                      <div className="text-xs text-muted-foreground/60 mt-0.5">
                        @{post.account}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* Click the hook pill to open the universal post drawer.
                        External-link cell still opens TikTok in a new tab. */}
                    <PostTrigger
                      postId={post.id}
                      className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-sm font-medium hover:bg-secondary/80"
                    >
                      {post.hook_style}
                    </PostTrigger>
                  </TableCell>
                  <TableCell className="text-sm">{post.format}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {post.flow || "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {post.views > 0 ? (
                      <span className="font-semibold">{post.views.toLocaleString()}</span>
                    ) : (
                      <span className="text-muted-foreground/30">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {post.likes > 0 ? (
                      <span className="font-semibold">{post.likes.toLocaleString()}</span>
                    ) : (
                      <span className="text-muted-foreground/30">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {post.saves > 0 ? (
                      <span className="font-semibold">{post.saves.toLocaleString()}</span>
                    ) : (
                      <span className="text-muted-foreground/30">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {post.save_rate > 0 ? (
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
                      // PostRowTrigger ignores clicks inside <a>, so the View
                      // link stays a normal new-tab open — no drawer behind it.
                      <a
                        href={post.tiktok_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-[#16a34a] hover:text-[#16a34a]/80 hover:underline transition-colors"
                      >
                        View
                      </a>
                    ) : (
                      <span className="text-muted-foreground/30">-</span>
                    )}
                  </TableCell>
                </PostRowTrigger>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {allPosts.length === 0 && (
        <Card>
          <CardContent className="text-center py-12 text-muted-foreground">
            No posts yet.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = status?.replace(/ \(.*\)/, "") || "unknown";
  const isPublished = status === "published";
  const isScheduled = status?.includes("scheduled");
  const isPending = status === "pending" || status === "in-progress";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${
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
