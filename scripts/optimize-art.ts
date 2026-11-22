import sharp from "sharp";
import { existsSync } from "node:fs";
import { CARDS } from "../shared/cards.js";
for (const card of CARDS) {
  const source = `public/art/cards/${card.id}.png`;
  if (!existsSync(source)) throw new Error(`缺少真实生图素材：${source}`);
  await sharp(source)
    .resize({ width: 768 })
    .webp({ quality: 84, effort: 6 })
    .toFile(`public/art/cards/${card.id}.webp`);
}
for (const name of ["logo", "card-back"]) {
  const source = `public/art/brand/${name}.png`;
  if (!existsSync(source)) throw new Error(`缺少品牌素材：${source}`);
  await sharp(source)
    .resize({ width: name === "logo" ? 320 : 768 })
    .webp({ quality: 86, effort: 6 })
    .toFile(`public/art/brand/${name}.webp`);
}
await sharp("public/art/brand/logo.png")
  .resize(64, 64, { fit: "contain" })
  .png()
  .toFile("public/favicon.png");
console.log("32 张卡牌和 2 张品牌素材已转换 WebP，保留原始 PNG。");
