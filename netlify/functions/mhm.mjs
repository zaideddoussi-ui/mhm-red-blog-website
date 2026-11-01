// MHM — API des histoires (Netlify Functions v2 + Netlify Blobs)
// Routes : GET /api/data · POST /api/post · POST /api/vote · POST /api/comment · POST /api/admin
//          DELETE /api/post/:id · DELETE /api/comment/:postId/:commentId   (modérateur uniquement)
// Le mot de passe modérateur est la variable d'environnement ADMIN_PASSWORD (Site configuration → Environment variables).
import { getStore } from "@netlify/blobs";

const MOODS = ["Stress", "Solitude", "Études", "Famille", "Espoir", "Autre"];
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (s) => String(s || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Petit cache mémoire (quelques secondes) : évite de relire tous les blobs à chaque rafraîchissement des visiteurs.
let cache = { t: 0, posts: null };
const invalidate = () => { cache = { t: 0, posts: null }; };

async function loadPosts(store) {
  if (cache.posts && Date.now() - cache.t < 3000) return cache.posts;
  const { blobs } = await store.list({ prefix: "post:" });
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  cache = { t: Date.now(), posts: all.filter(Boolean).sort((a, b) => b.ts - a.ts).slice(0, 300) };
  return cache.posts;
}

// Anti-spam par IP : renvoie true si l'action est trop rapprochée
async function limited(store, key, ms) {
  const last = await store.get(key, { type: "json" });
  if (last && Date.now() - last < ms) return true;
  await store.setJSON(key, Date.now());
  return false;
}

export default async (req, context) => {
  const store = getStore({ name: "mhm", consistency: "strong" });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const secret = (typeof Netlify !== "undefined" && Netlify.env.get("ADMIN_PASSWORD")) || "";
  const isAdmin = () => secret !== "" && (req.headers.get("x-admin-key") || "") === secret;
  const ip = clean(context.ip || "anon");
  const body = async () => { try { return await req.json(); } catch { return null; } };

  try {
    // Liste des histoires (+ totaux de votes, commentaires, vote de l'appareil demandeur)
    if (req.method === "GET" && path === "data") {
      const voter = clean(url.searchParams.get("voter"));
      const posts = (await loadPosts(store)).map((p) => {
        const v = Object.values(p.votes || {});
        return { id: p.id, text: p.text, mood: p.mood, ts: p.ts, up: v.filter((x) => x === 1).length, down: v.filter((x) => x === -1).length, my: (p.votes || {})[voter] || 0, comments: p.comments || [] };
      });
      return json({ posts });
    }

    // Nouvelle histoire
    if (req.method === "POST" && path === "post") {
      const b = await body(); if (!b) return json({ error: "bad_json" }, 400);
      const text = String(b.text || "").trim().slice(0, 1200);
      const mood = MOODS.includes(b.mood) ? b.mood : "Autre";
      if (text.length < 20) return json({ error: "too_short" }, 400);
      if (await limited(store, "rl:" + ip, 20000)) return json({ error: "rate_limited" }, 429);
      let id = /^p[a-z0-9]{8,24}$/.test(b.id || "") ? b.id : newId("p");
      if (await store.get("post:" + id, { type: "json" })) id = newId("p");
      await store.setJSON("post:" + id, { id, text, mood, ts: Date.now(), votes: {}, comments: [] });
      invalidate();
      return json({ id });
    }

    // Vote (un par appareil et par histoire ; v = 1, -1 ou 0 pour annuler)
    if (req.method === "POST" && path === "vote") {
      const b = await body(); if (!b) return json({ error: "bad_json" }, 400);
      const id = clean(b.id), voter = clean(b.voter), v = b.v === 1 ? 1 : b.v === -1 ? -1 : 0;
      if (!id || !voter) return json({ error: "bad_request" }, 400);
      const post = await store.get("post:" + id, { type: "json" });
      if (!post) return json({ error: "not_found" }, 404);
      post.votes = post.votes || {};
      if (v) post.votes[voter] = v; else delete post.votes[voter];
      await store.setJSON("post:" + id, post); invalidate();
      return json({ ok: true });
    }

    // Commentaire anonyme (2 à 300 caractères, 60 par histoire, anti-spam)
    if (req.method === "POST" && path === "comment") {
      const b = await body(); if (!b) return json({ error: "bad_json" }, 400);
      const id = clean(b.id), text = String(b.text || "").trim().slice(0, 300);
      if (!id || text.length < 2) return json({ error: "bad_request" }, 400);
      if (await limited(store, "rlc:" + ip, 6000)) return json({ error: "rate_limited" }, 429);
      const post = await store.get("post:" + id, { type: "json" });
      if (!post) return json({ error: "not_found" }, 404);
      post.comments = post.comments || [];
      if (post.comments.length >= 60) return json({ error: "thread_full" }, 409);
      const cid = newId("c");
      post.comments.push({ id: cid, text, ts: Date.now() });
      await store.setJSON("post:" + id, post); invalidate();
      return json({ id: cid });
    }

    // Vérification du mot de passe modérateur
    if (req.method === "POST" && path === "admin") {
      const b = await body();
      return json({ ok: !!b && secret !== "" && b.password === secret });
    }

    // Suppressions (modérateur uniquement)
    if (req.method === "DELETE" && path.startsWith("post/")) {
      if (!isAdmin()) return json({ error: "forbidden" }, 403);
      await store.delete("post:" + clean(path.slice(5))); invalidate();
      return json({ ok: true });
    }
    if (req.method === "DELETE" && path.startsWith("comment/")) {
      if (!isAdmin()) return json({ error: "forbidden" }, 403);
      const [, pid, cid] = path.split("/");
      const post = await store.get("post:" + clean(pid), { type: "json" });
      if (!post) return json({ error: "not_found" }, 404);
      post.comments = (post.comments || []).filter((c) => c.id !== clean(cid));
      await store.setJSON("post:" + clean(pid), post); invalidate();
      return json({ ok: true });
    }

    return json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: "server_error" }, 500);
  }
};

export const config = { path: "/api/*" };
