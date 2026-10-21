// Combines library/recipes/*.json into library/recipes.json and checks every
// recipe and person file. Runs in GitHub Actions before each deploy; a bad file
// fails the build so the live site never breaks. Run locally: node scripts/build-library.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const LIB_DIR = join(ROOT, "library", "recipes");
const PEOPLE_DIR = join(ROOT, "people");
const PROTEINS = new Set(["chicken", "beef", "pork", "seafood", "eggs", "meatless"]);
const STR = ["id", "title", "servings", "prep", "cook", "total", "storage"];
const LIST = ["equipment", "steps", "tips"];

const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

function checkRecipe(r, file) {
  for (const k of STR) if (typeof r[k] !== "string" || !r[k].trim()) fail(file, `missing ${k}`);
  for (const k of LIST) if (!Array.isArray(r[k]) || !r[k].every((s) => typeof s === "string")) fail(file, `${k} must be a list of text`);
  if (!Array.isArray(r.steps) || r.steps.length === 0) fail(file, "needs at least one step");
  if (!Array.isArray(r.proteins) || !r.proteins.every((p) => PROTEINS.has(p))) fail(file, "bad proteins");
  if (typeof r.slowCooker !== "boolean" || typeof r.cozy !== "boolean") fail(file, "slowCooker/cozy must be true or false");
  if (!Array.isArray(r.ingredients) || !r.ingredients.length) fail(file, "needs ingredients");
  else for (const g of r.ingredients) {
    if (!(g.group === null || typeof g.group === "string")) fail(file, "ingredient group name must be text or null");
    if (!Array.isArray(g.items) || !g.items.length || !g.items.every((s) => typeof s === "string")) fail(file, "ingredient group needs items");
  }
  if (`${r.id}.json` !== file) fail(file, `id "${r.id}" doesn't match the file name`);
  if (r.nutrition != null) {
    const n = r.nutrition, keys = ["calories", "protein_g", "carbs_g", "fat_g", "saturated_fat_g", "fiber_g", "sugar_g", "sodium_mg"];
    if (typeof n !== "object" || !n.perServing || !keys.every((k) => typeof n.perServing[k] === "number" && n.perServing[k] >= 0)) fail(file, "bad nutrition estimate");
  }
  if (r.photo != null) {
    if (typeof r.photo !== "string" || !/^library\/photos\/[a-z0-9-]+\.jpg$/.test(r.photo)) fail(file, `bad photo path "${r.photo}"`);
    else if (!existsSync(join(ROOT, r.photo))) { console.warn(`${file}: photo ${r.photo} is missing, so it's left off`); r.photo = null; }
  }
}

const recipes = [];
for (const file of readdirSync(LIB_DIR).filter((f) => f.endsWith(".json")).sort()) {
  let r;
  try { r = JSON.parse(readFileSync(join(LIB_DIR, file), "utf8")); }
  catch (e) { fail(file, `not valid JSON (${e.message})`); continue; }
  checkRecipe(r, file);
  recipes.push(r);
}
const ids = new Set(recipes.map((r) => r.id));

for (const file of readdirSync(PEOPLE_DIR).filter((f) => f.endsWith(".json"))) {
  let p;
  try { p = JSON.parse(readFileSync(join(PEOPLE_DIR, file), "utf8")); }
  catch (e) { fail(file, `not valid JSON (${e.message})`); continue; }
  const sections = new Set((p.sections || []).map((s) => s.id));
  if (!sections.size) fail(file, "needs at least one section");
  const seen = new Set();
  for (const b of p.box || []) {
    if (!ids.has(b.id)) fail(file, `box lists "${b.id}", which isn't in the library`);
    if (seen.has(b.id)) fail(file, `box lists "${b.id}" twice`);
    seen.add(b.id);
    if (!sections.has(b.section)) fail(file, `"${b.id}" is in unknown section "${b.section}"`);
    if (!Array.isArray(b.tags) || !b.tags.every((t) => typeof t === "string")) fail(file, `"${b.id}" tags must be a list of text`);
    if (!b.made || !Number.isInteger(b.made.count) || b.made.count < 0 || !Array.isArray(b.made.log)) fail(file, `"${b.id}" has a bad made record`);
  }
}

if (errors.length) {
  console.error(`Library check failed (${errors.length}):\n - ` + errors.join("\n - "));
  process.exit(1);
}
recipes.sort((a, b) => (a.addedAt || "").localeCompare(b.addedAt || "") || a.id.localeCompare(b.id));
writeFileSync(join(ROOT, "library", "recipes.json"), JSON.stringify({ recipes }) + "\n");
console.log(`Built library/recipes.json with ${recipes.length} recipes.`);
