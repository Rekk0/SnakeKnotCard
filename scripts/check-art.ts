import sharp from "sharp";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { CARDS } from "../shared/cards.js";
const hashes = new Set<string>();
let webBytes = 0;
for (const card of CARDS) {
  const raw = `public/art/cards/${card.id}.png`;
  const web = `public/art/cards/${card.id}.webp`;
  const meta = await sharp(raw).metadata();
  if (meta.width !== 1024 || meta.height !== 1536)
    throw new Error(`${raw}尺寸不是1024×1536`);
  const hash = createHash("sha256").update(readFileSync(raw)).digest("hex");
  if (hashes.has(hash)) throw new Error(`发现重复卡面：${raw}`);
  hashes.add(hash);
  const m = await sharp(web).metadata();
  if (m.format !== "webp" || m.width !== 768 || m.height !== 1152)
    throw new Error(`${web}格式或尺寸无效`);
  webBytes += statSync(web).size;
}
for (const name of ["logo", "card-back"]) {
  const m = await sharp(`public/art/brand/${name}.webp`).metadata();
  if (m.format !== "webp") throw new Error(`${name}缺少有效网页资源`);
}
const logo = await sharp("public/art/brand/logo.png").metadata();
if (!logo.width || !logo.height) throw new Error("Logo 图像无效");
console.log(
  `美术验证通过：32 张互不相同的 1024×1536 原图与 WebP、2 张品牌素材，卡面网页体积 ${(webBytes / 1024 / 1024).toFixed(2)} MB。`,
);
