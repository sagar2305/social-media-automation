import { readFile } from "node:fs/promises";
import { requireRole } from "@/lib/auth";
import { getCreddySlidePath } from "@/lib/creddy-file-store";
import { downloadCreddyCloudAsset } from "@/lib/creddy-cloud-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; slide: string }> },
) {
  await requireRole("viewer");
  const { id, slide } = await context.params;
  try {
    const media = await getCreddySlidePath(id, Number(slide));
    const body = await readFile(media.path);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": media.mime,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    try {
      const media = await downloadCreddyCloudAsset({ id, kind: "slide", slide: Number(slide) });
      return new Response(media.body, {
        headers: {
          "Content-Type": media.mime,
          "Content-Length": String(media.size),
          "Cache-Control": "private, max-age=3600",
          "Content-Disposition": "inline",
        },
      });
    } catch {
      return new Response("Slide not found", { status: 404 });
    }
  }
}
