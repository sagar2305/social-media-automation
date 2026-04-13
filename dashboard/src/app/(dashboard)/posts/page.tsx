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

export const revalidate = 300;

export default async function PostsPage() {
  const supabase = await createClient();
  const { data: posts } = await supabase
    .from("posts")
    .select("*")
    .order("date", { ascending: false });

  const allPosts = posts ?? [];
  const published = allPosts.filter((p) => p.status === "published").length;

  // Group posts by account
  const accountMap = new Map<string, typeof allPosts>();
  for (const post of allPosts) {
    const account = post.account || "Unknown";
    if (!accountMap.has(account)) accountMap.set(account, []);
    accountMap.get(account)!.push(post);
  }
  const accounts = Array.from(accountMap.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-5xl font-semibold tracking-tight">Posts</h1>
          <p className="text-lg text-muted-foreground mt-2">
            Content analytics per account.
          </p>
        </div>
        <div className="flex items-center gap-4">
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
        </div>
        <div className="flex gap-8 tabular-nums">
          <div className="text-right">
            <p className="text-3xl font-semibold">{allPosts.length}</p>
            <p className="text-sm text-muted-foreground">Total</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold">{published}</p>
            <p className="text-sm text-muted-foreground">Published</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold text-muted-foreground/50">
              {allPosts.length - published}
            </p>
            <p className="text-sm text-muted-foreground">Drafts</p>
          </div>
        </div>
      </div>

      {accounts.map(([account, accountPosts]) => {
        const totalViews = accountPosts.reduce((s, p) => s + (p.views || 0), 0);
        const totalLikes = accountPosts.reduce((s, p) => s + (p.likes || 0), 0);
        const totalSaves = accountPosts.reduce((s, p) => s + (p.saves || 0), 0);
        const avgSaveRate =
          accountPosts.length > 0
            ? (
                accountPosts.reduce((s, p) => s + (Number(p.save_rate) || 0), 0) /
                accountPosts.length
              ).toFixed(1)
            : "0";
        const pubCount = accountPosts.filter((p) => p.status === "published").length;

        return (
          <div key={account} className="space-y-4">
            <div className="flex items-end justify-between">
              <h2 className="text-2xl font-semibold tracking-tight">
                @{account}
              </h2>
              <div className="flex gap-6 tabular-nums text-sm">
                <div className="text-right">
                  <p className="text-lg font-semibold">{accountPosts.length}</p>
                  <p className="text-muted-foreground">Posts</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{totalViews.toLocaleString()}</p>
                  <p className="text-muted-foreground">Views</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{totalLikes.toLocaleString()}</p>
                  <p className="text-muted-foreground">Likes</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{totalSaves.toLocaleString()}</p>
                  <p className="text-muted-foreground">Saves</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{avgSaveRate}%</p>
                  <p className="text-muted-foreground">Avg Save %</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{pubCount}/{accountPosts.length}</p>
                  <p className="text-muted-foreground">Published</p>
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
                    {accountPosts.map((post) => (
                      <TableRow key={post.id}>
                        <TableCell className="whitespace-nowrap tabular-nums text-sm">
                          {post.date}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-sm font-medium">
                            {post.hook_style}
                          </span>
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        );
      })}

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
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${
        isPublished
          ? "bg-[#248a3d]/10 text-[#248a3d]"
          : isScheduled
            ? "bg-[#bf4800]/10 text-[#bf4800]"
            : "bg-secondary text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}
