import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("assets/creddy/slideshow-emotion-gestures-v4-1080x1440");
const faceCatalog = JSON.parse(
  await readFile(
    path.resolve("assets/creddy/slideshow-facial-expressions-v3-1080x1440/catalog.json"),
    "utf8",
  ),
);
const gestures = JSON.parse(await readFile(path.join(root, "gesture-presets.json"), "utf8"));

if (faceCatalog.length !== 100) throw new Error(`Expected 100 faces, found ${faceCatalog.length}`);

const expressions = [];
for (let index = 0; index < faceCatalog.length; index += 1) {
  const face = index === 1
    ? {
        id: "002-happy-waving",
        face: "happy waving; bright forward eyes, cheerful eyebrows, and a clean friendly open smile",
      }
    : faceCatalog[index];
  const file = `${face.id}.png`;
  await access(path.join(root, file));
  expressions.push({
    name: face.id,
    file,
    face: face.face,
    gesture: gestures[index % gestures.length],
    width: 1080,
    height: 1440,
    aspectRatio: "3:4",
    characterStandard: "locked-creddy-v4",
    cStandard: "complete-front-wrap-master",
  });
}

const manifest = {
  version: 4,
  canvas: "1080x1440",
  count: expressions.length,
  policy: {
    locked: [
      "Creddy identity and materials",
      "complete gold C size, silhouette, position, and front/back layering",
      "antenna, star, chip, legs, feet, pedestal, backdrop, spotlight, and framing",
    ],
    variable: ["facial expression", "arm movement", "hand gesture"],
    disallowed: ["unapproved props", "text", "floating symbols", "extra limbs", "broken C"],
  },
  expressions,
};
await writeFile(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const cards = expressions
  .map(
    (item, index) => `
      <article class="card">
        <img src="${item.file}" alt="${item.name}" loading="lazy">
        <div class="meta"><strong>${String(index + 1).padStart(3, "0")} · ${item.name.replace(/^\d+-/, "").replaceAll("-", " ")}</strong><span>${item.gesture}</span></div>
      </article>`,
  )
  .join("");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Creddy — 100 Emotion & Gesture Library</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b0a09;color:#f5efe4;font:15px/1.45 Arial,sans-serif}header{position:sticky;top:0;z-index:2;background:#0b0a09eF;backdrop-filter:blur(12px);border-bottom:1px solid #4c3a1d;padding:24px 4vw}h1{font:700 clamp(28px,4vw,52px)/1 Georgia,serif;margin:0 0 10px}.summary{color:#cdb98f}.pills{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.pill{border:1px solid #735723;border-radius:999px;padding:6px 11px;color:#e0bf76}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:18px;padding:28px 4vw 60px}.card{background:#17130e;border:1px solid #392c18;border-radius:16px;overflow:hidden}.card img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;background:#000}.meta{padding:13px}.meta strong{display:block;text-transform:capitalize;color:#f5efe4}.meta span{display:block;color:#a99b84;font-size:12px;margin-top:6px}
</style></head><body><header><h1>100 Creddy emotions & gestures</h1><div class="summary">One locked character and C standard, with controlled facial expressions and hand movements.</div><div class="pills"><span class="pill">100 assets</span><span class="pill">1080 × 1440</span><span class="pill">3:4 slideshow format</span><span class="pill">v4 review library</span></div></header><main>${cards}</main></body></html>`;
await writeFile(path.join(root, "review-index.html"), html);

console.log(JSON.stringify({ root, count: expressions.length }, null, 2));
