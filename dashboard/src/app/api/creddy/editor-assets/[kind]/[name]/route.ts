import { createReadStream } from "node:fs";
import { basename, resolve } from "node:path";
import { Readable } from "node:stream";

import { requireRole } from "@/lib/auth";
import {
  CREDDY_EXPRESSION_FILES,
  CREDDY_PHONE_TEMPLATE_FILES,
} from "@/lib/creddy-slide-options";

function repoRoot() {
  if (process.env.CREDDY_REPO_ROOT) return resolve(process.env.CREDDY_REPO_ROOT);
  return basename(process.cwd()) === "dashboard" ? resolve(process.cwd(), "..") : process.cwd();
}

function approvedAsset(kind: string, name: string) {
  const base = resolve(repoRoot(), "assets", "creddy");
  if (kind === "expression" && name in CREDDY_EXPRESSION_FILES) {
    const file = CREDDY_EXPRESSION_FILES[name as keyof typeof CREDDY_EXPRESSION_FILES];
    return { path: resolve(base, "slideshow-expressions-1080x1440", file), mime: "image/png" };
  }
  if (kind === "phone" && name in CREDDY_PHONE_TEMPLATE_FILES) {
    const file = CREDDY_PHONE_TEMPLATE_FILES[name as keyof typeof CREDDY_PHONE_TEMPLATE_FILES];
    return { path: resolve(base, "slideshow-templates", "phone-screens", file), mime: "image/png" };
  }
  if (kind === "font" && name === "headline") {
    return { path: resolve(base, "slideshow-templates", "fonts", "tungsten-condensed-bold.ttf"), mime: "font/ttf" };
  }
  if (kind === "font" && name === "card") {
    return { path: resolve(base, "slideshow-templates", "fonts", "DIN-Condensed-Bold.ttf"), mime: "font/ttf" };
  }
  return null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string; name: string }> },
) {
  await requireRole("viewer");
  const { kind, name } = await context.params;
  const asset = approvedAsset(kind, name);
  if (!asset) return new Response("Editor asset not found", { status: 404 });

  try {
    return new Response(Readable.toWeb(createReadStream(asset.path)) as ReadableStream, {
      headers: {
        "Content-Type": asset.mime,
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return new Response("Editor asset not found", { status: 404 });
  }
}
