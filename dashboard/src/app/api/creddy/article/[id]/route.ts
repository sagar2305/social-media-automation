import { readFile } from "node:fs/promises";

import { requireRole } from "@/lib/auth";
import { getCreddyArticlePreviewPath } from "@/lib/creddy-file-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireRole("viewer");
  const { id } = await context.params;
  try {
    const path = await getCreddyArticlePreviewPath(id);
    return new Response(await readFile(path, "utf8"), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'none'; frame-ancestors 'self'",
      },
    });
  } catch {
    return new Response("Article preview not found", { status: 404 });
  }
}
