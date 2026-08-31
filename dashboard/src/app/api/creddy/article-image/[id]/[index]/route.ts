import { readFile } from "node:fs/promises";

import { requireRole } from "@/lib/auth";
import { getCreddyArticleImagePath } from "@/lib/creddy-file-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; index: string }> },
) {
  await requireRole("viewer");
  const { id, index } = await context.params;
  try {
    const image = await getCreddyArticleImagePath(id, Number(index));
    return new Response(await readFile(image.path), {
      headers: { "Content-Type": image.mime, "Cache-Control": "private, no-store" },
    });
  } catch {
    return new Response("Article image not found", { status: 404 });
  }
}
