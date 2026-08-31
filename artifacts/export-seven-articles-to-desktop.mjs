import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot =
  "/Users/mohitkourav/Documents/ChatGPT/Social media automation data/creddy/06-content-packages/articles";
const destinationRoot = "/Users/mohitkourav/Desktop/Creddy 7 Complete Articles";

const articles = [
  [
    "production-ranking-17297b0bc4c1ff3210886899",
    "01 - Southwest Rapid Rewards",
    "Southwest-Rapid-Rewards-Article.html",
  ],
  [
    "production-ranking-36c7c0b604db3d0d10312554",
    "02 - Marriott Bonvoy Brilliant Elite Benefits",
    "Marriott-Bonvoy-Brilliant-Elite-Benefits-Article.html",
  ],
  [
    "production-ranking-5befbe27eb8a94b98257e984",
    "03 - JetBlue TrueBlue",
    "JetBlue-TrueBlue-Article.html",
  ],
  [
    "production-ranking-8407893c1526145efb688c01",
    "04 - American Airlines AAdvantage",
    "American-Airlines-AAdvantage-Article.html",
  ],
  [
    "production-ranking-9ec326bba59e1af1d155e0bf",
    "05 - Amex Gold Travel Benefits",
    "Amex-Gold-Travel-Benefits-Article.html",
  ],
  [
    "production-ranking-d34933142b4275e97022e8c1",
    "06 - Hotel Fees Before Amex Points Transfer",
    "Hotel-Fees-Before-Amex-Points-Transfer-Article.html",
  ],
  [
    "production-ranking-ec11a5add69f05fa28f4354b",
    "07 - Atmos Rewards 2026",
    "Atmos-Rewards-2026-Article.html",
  ],
];

const rows = [];
for (const [packageName, folderName, fileName] of articles) {
  const packageDir = path.join(sourceRoot, packageName);
  const destinationDir = path.join(destinationRoot, folderName);
  let html = await readFile(path.join(packageDir, "index.html"), "utf8");
  const assetNames = [
    ...new Set(
      [...html.matchAll(/src=(?:\\?)["']assets\/([^"']+\.png)(?:\\?)["']/g)].map(
        (match) => match[1],
      ),
    ),
  ];

  for (const assetName of assetNames) {
    const image = await readFile(path.join(packageDir, "assets", assetName));
    const dataUri = `data:image/png;base64,${image.toString("base64")}`;
    html = html.split(`assets/${assetName}`).join(dataUri);
  }

  await mkdir(destinationDir, { recursive: true });
  await writeFile(path.join(destinationDir, fileName), html);
  rows.push({ folderName, fileName, imageCount: assetNames.length });
}

const links = rows
  .map(
    ({ folderName, fileName, imageCount }) =>
      `<li><a href="${encodeURI(`${folderName}/${fileName}`)}">${folderName.replace(/^\d+ - /, "")}</a><span>${imageCount} embedded photos</span></li>`,
  )
  .join("");
const index = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Creddy — Seven Complete Articles</title><style>body{margin:0;background:#f7f4ee;color:#1f1b17;font:18px/1.5 Arial,sans-serif}main{max-width:900px;margin:auto;padding:64px 24px}h1{font:700 54px/1.05 Georgia,serif;margin:8px 0 16px}.eyebrow{color:#a36d16;text-transform:uppercase;letter-spacing:.15em;font-size:13px}p{color:#69625a}ul{list-style:none;padding:0;display:grid;gap:14px;margin-top:36px}li{background:#fff;border:1px solid #ddd5c8;border-radius:16px;padding:20px 22px;display:flex;justify-content:space-between;gap:20px;align-items:center}a{color:#1f1b17;font-weight:700;text-decoration:none}a:hover{text-decoration:underline}span{font-size:14px;color:#8b8175}@media(max-width:650px){h1{font-size:40px}li{align-items:flex-start;flex-direction:column;gap:4px}}</style></head><body><main><div class="eyebrow">Creddy editorial collection</div><h1>Seven complete rewards guides</h1><p>Each article is a self-contained HTML file with three embedded photos, so it can be opened offline and shared without a separate assets folder.</p><ul>${links}</ul></main></body></html>`;
await mkdir(destinationRoot, { recursive: true });
await writeFile(path.join(destinationRoot, "Open All 7 Articles.html"), index);

console.log(JSON.stringify({ destinationRoot, articles: rows }, null, 2));
