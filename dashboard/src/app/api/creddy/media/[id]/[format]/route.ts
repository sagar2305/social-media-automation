import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { requireRole } from "@/lib/auth";
import { getCreddyMediaPath } from "@/lib/creddy-file-store";
import { downloadCreddyCloudAsset } from "@/lib/creddy-cloud-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; format: string }> },
) {
  await requireRole("viewer");
  const { id, format } = await context.params;
  if (format !== "text_music" && format !== "narrated") {
    return new Response("Invalid video format", { status: 400 });
  }
  try {
    const media = await getCreddyMediaPath(id, format);
    return new Response(Readable.toWeb(createReadStream(media.path)) as ReadableStream, {
      headers: {
        "Content-Type": media.mime,
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    try {
      const media = await downloadCreddyCloudAsset({ id, kind: format });
      return new Response(media.body, {
        headers: {
          "Content-Type": media.mime,
          "Content-Length": String(media.size),
          "Cache-Control": "private, max-age=3600",
          "Content-Disposition": "inline",
        },
      });
    } catch {
      return new Response("Video not found", { status: 404 });
    }
  }
}
