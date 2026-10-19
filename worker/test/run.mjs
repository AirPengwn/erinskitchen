// Offline test of the helper: fakes the Claude API and GitHub, then exercises
// every route the site uses. Nothing real is called. Run: npm test
import assert from "node:assert/strict";
import worker from "../src/index.js";

const ORIGIN = "https://airpengwn.github.io";
const env = {
  ANTHROPIC_API_KEY: "test-key", GITHUB_TOKEN: "test-token", PASSCODE: "correct horse",
  GITHUB_REPO: "AirPengwn/erinskitchen", GITHUB_BRANCH: "main", ALLOWED_ORIGINS: ORIGIN,
  MODEL: "claude-opus-5-5", EFFORT: "medium",
};

// ---- fake GitHub repo ----
const files = new Map();
let shaN = 0;
const put = (path, text) => files.set(path, { text, sha: `sha${++shaN}` });
put("people/erin.json", JSON.stringify({ id: "erin", name: "Erin", sections: [{ id: "tex-mex", title: "Tex-Mex" }, { id: "soups-stews", title: "Soups & stews" }], box: [] }));
put("library/recipes/chili-with-cornbread.json", "{}");

// ---- fake Claude answer ----
const fakeRecipe = {
  isRecipe: true, title: "Chili with cornbread", proteins: ["beef"], slowCooker: false, cozy: true,
  servings: "6 servings", prep: "15 min", cook: "45 min", total: "1 hr",
  equipment: ["5-quart Dutch oven", "Instant-read thermometer"],
  ingredients: [{ group: "", items: ["1 lb ground beef", "1 onion, diced"] }, { group: "Toppings", items: ["½ cup sour cream"] }],
  steps: ["Brown the beef over medium-high heat until it reads 160°F.", "Simmer 30 min."],
  tips: ["Make it a day ahead."], storage: "Fridge up to 4 days.", credit: "Grandma's card",
  note: "A weeknight chili.", suggestedSection: "tex-mex", assumptions: ["Added a safe temperature."],
};
let lastClaudeBody = null, claudeAnswer = fakeRecipe;

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method || (input.method) || "GET").toUpperCase();
  if (url.startsWith("https://api.anthropic.com/v1/messages")) {
    lastClaudeBody = JSON.parse(typeof init.body === "string" ? init.body : await new Response(init.body).text());
    lastClaudeBody._headers = Object.fromEntries(new Headers(init.headers).entries());
    return new Response(JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(claudeAnswer) }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" } });
  }
  const m = url.match(/^https:\/\/api\.github\.com\/repos\/AirPengwn\/erinskitchen\/contents\/([^?]+)/);
  if (m) {
    const path = decodeURIComponent(m[1]);
    const auth = new Headers(init.headers).get("authorization");
    assert.equal(auth, "Bearer test-token");
    if (method === "GET") {
      const f = files.get(path);
      if (!f) return new Response("{}", { status: 404 });
      return Response.json({ sha: f.sha, content: Buffer.from(f.text, "utf8").toString("base64") });
    }
    if (method === "PUT") {
      const body = JSON.parse(init.body);
      const f = files.get(path);
      if (f && body.sha !== f.sha) return new Response("{}", { status: 409 });
      if (!f && body.sha) return new Response("{}", { status: 409 });
      put(path, Buffer.from(body.content, "base64").toString("utf8"));
      return Response.json({ content: { sha: files.get(path).sha } }, { status: f ? 200 : 201 });
    }
  }
  throw new Error("Unexpected fetch " + method + " " + url);
};

const call = (path, body, method = "POST", origin = ORIGIN) =>
  worker.fetch(new Request("https://helper.example" + path, {
    method, headers: { "Content-Type": "application/json", Origin: origin }, body: method === "POST" ? JSON.stringify(body) : undefined,
  }), env);

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("  ok -", name); }

await test("CORS preflight allows the site and nothing else", async () => {
  const ok = await call("/parse", null, "OPTIONS");
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  const bad = await call("/parse", null, "OPTIONS", "https://evil.example");
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

await test("wrong passcode is refused", async () => {
  const r = await call("/parse", { passcode: "nope", person: "erin", text: "x" });
  assert.equal(r.status, 401);
  assert.match((await r.json()).error, /passcode/);
});

await test("check route accepts the right passcode", async () => {
  const r = await call("/check", { passcode: "correct horse" });
  assert.equal(r.status, 200);
});

await test("parse sends text + image to Claude with the schema and fallback, returns a clean recipe", async () => {
  const r = await call("/parse", {
    passcode: "correct horse", person: "erin", text: "Chili: 1 lb beef...",
    images: [{ media_type: "image/jpeg", data: "AAAA" }], sections: [{ id: "tex-mex", title: "Tex-Mex" }],
  });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(lastClaudeBody.model, "claude-opus-5-5");
  assert.equal(lastClaudeBody.fallbacks, "default");
  assert.match(lastClaudeBody._headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(lastClaudeBody.output_config.format.type, "json_schema");
  assert.equal(lastClaudeBody.output_config.effort, "medium");
  assert.equal(lastClaudeBody.messages[0].content[0].type, "image");
  assert.match(lastClaudeBody.messages[0].content[1].text, /tex-mex: Tex-Mex/);
  assert.equal(j.recipe.ingredients[0].group, null);
  assert.equal(j.recipe.ingredients[1].group, "Toppings");
  assert.equal(j.recipe.credit, "Grandma's card");
  assert.equal(j.suggestedSection, "tex-mex");
  assert.deepEqual(j.assumptions, ["Added a safe temperature."]);
});

await test("a correction resends the previous recipe and the fix", async () => {
  const r = await call("/parse", { passcode: "correct horse", person: "erin", previous: { title: "Chili" }, fix: "2 lb beef" });
  assert.equal(r.status, 200);
  assert.match(lastClaudeBody.messages[0].content.at(-1).text, /Correction:\n2 lb beef/);
});

await test("not-a-recipe comes back as a friendly 422", async () => {
  claudeAnswer = { ...fakeRecipe, isRecipe: false, assumptions: ["This is a photo of a dog."] };
  const r = await call("/parse", { passcode: "correct horse", person: "erin", text: "woof" });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error, "This is a photo of a dog.");
  claudeAnswer = fakeRecipe;
});

await test("oversized image is rejected before calling Claude", async () => {
  lastClaudeBody = null;
  const r = await call("/parse", { passcode: "correct horse", person: "erin", images: [{ media_type: "image/jpeg", data: "A".repeat(7_000_001) }] });
  assert.equal(r.status, 413);
  assert.equal(lastClaudeBody, null);
});

await test("save into the box picks a free id, writes the recipe and updates the person file", async () => {
  const { recipe } = await (await call("/parse", { passcode: "correct horse", person: "erin", text: "chili" })).json();
  const r = await call("/save", { passcode: "correct horse", person: "erin", recipe, box: { mode: "made", section: "soups-stews", note: "Cozy." } });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.id, "chili-with-cornbread-2"); // the plain id already exists
  const saved = JSON.parse(files.get("library/recipes/chili-with-cornbread-2.json").text);
  assert.equal(saved.id, "chili-with-cornbread-2");
  assert.equal(saved.addedBy, "erin");
  assert.equal(saved.ingredients[1].items[0], "½ cup sour cream");
  const p = JSON.parse(files.get("people/erin.json").text);
  assert.equal(p.box.length, 1);
  assert.deepEqual(p.box[0], { id: "chili-with-cornbread-2", section: "soups-stews", source: "made", note: "Cozy.", madeTimes: 1, madeDates: p.box[0].madeDates, confidence: "clear" });
});

await test("library-only save leaves the person file alone", async () => {
  const before = files.get("people/erin.json").sha;
  const r = await call("/save", { passcode: "correct horse", person: "erin", recipe: { ...fakeRecipe, title: "Tomato soup" }, box: { mode: "library" } });
  assert.equal(r.status, 200);
  assert.ok(files.has("library/recipes/tomato-soup.json"));
  assert.equal(files.get("people/erin.json").sha, before);
});

await test("unknown person and incomplete recipes are refused", async () => {
  assert.equal((await call("/save", { passcode: "correct horse", person: "nobody", recipe: fakeRecipe, box: { mode: "new" } })).status, 400);
  assert.equal((await call("/save", { passcode: "correct horse", person: "../etc", recipe: fakeRecipe })).status, 400);
  assert.equal((await call("/save", { passcode: "correct horse", person: "erin", recipe: { title: "x" } })).status, 400);
});

console.log(`\n${passed} tests passed.`);
