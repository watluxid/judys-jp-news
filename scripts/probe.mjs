#!/usr/bin/env node
/**
 * Feed maintenance helper: probes sites for working RSS/Atom feeds.
 * - Auto-discovers feeds from each homepage's <link rel="alternate"> tags
 * - Tests candidate feed URLs and reports status + item count
 * Usage: node scripts/probe.mjs   (needs open internet, e.g. GitHub Actions)
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const TARGETS = [
  { site: "https://www.animatetimes.com/", candidates: ["https://www.animatetimes.com/rss/index.php", "https://www.animatetimes.com/rss/"] },
  { site: "https://www.inside-games.jp/", candidates: ["https://www.inside-games.jp/rss/index.rdf", "https://www.inside-games.jp/rss20/index.rdf"] },
  { site: "https://animeanime.jp/", candidates: ["https://animeanime.jp/rss/index.rdf", "https://animeanime.jp/rss20/index.rdf"] },
  { site: "https://www.tokyoartbeat.com/", candidates: ["https://www.tokyoartbeat.com/rss/ja.xml"] },
  { site: "https://www.art-annual.jp/", candidates: [] },
  { site: "https://bluediary2.jugem.jp/", candidates: ["https://bluediary2.jugem.jp/?mode=rss"] },
  { site: "https://ototoy.jp/news/", candidates: ["https://ototoy.jp/news/rss", "https://ototoy.jp/news/index.rss"] },
  { site: "https://realsound.jp/", candidates: ["https://realsound.jp/feed"] },
  { site: "https://tokion.jp/", candidates: [] },
];

const COMMON_PATHS = ["feed", "feed/", "rss", "rss.xml", "atom.xml", "index.rdf", "rss/index.rdf", "feed/rss", "?feed=rss2"];

async function get(url, ua = BROWSER_UA) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": ua, Accept: "*/*" },
    });
    const text = await res.text();
    return { status: res.status, type: res.headers.get("content-type") || "", text, finalUrl: res.url };
  } catch (e) {
    return { status: 0, type: "", text: "", error: e.cause?.message || e.message };
  } finally {
    clearTimeout(t);
  }
}

function looksLikeFeed(text) {
  const head = text.slice(0, 3000);
  if (!/<(rss|feed|rdf)[\s:>]/i.test(head)) return 0;
  return (text.match(/<item[\s>]/gi) || []).length + (text.match(/<entry[\s>]/gi) || []).length;
}

function discover(html, base) {
  const found = new Set();
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']alternate["']/i.test(tag)) continue;
    if (!/application\/(rss|atom|rdf)/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (href) {
      try { found.add(new URL(href[1], base).toString()); } catch {}
    }
  }
  return [...found];
}

for (const { site, candidates } of TARGETS) {
  console.log(`\n===== ${site}`);
  const home = await get(site);
  console.log(`  homepage: HTTP ${home.status} ${home.error || ""}`);
  const discovered = home.text ? discover(home.text, home.finalUrl || site) : [];
  if (discovered.length) console.log(`  discovered: ${discovered.join("  ")}`);

  const origin = new URL(site).origin + "/";
  const toTest = [...new Set([...discovered, ...candidates, ...COMMON_PATHS.map((p) => origin + p)])];
  for (const url of toTest) {
    const r = await get(url);
    const items = looksLikeFeed(r.text);
    const verdict = r.status === 200 && items > 0 ? `✓ FEED (${items} items)` : r.status === 200 ? "not-a-feed" : r.error || "";
    console.log(`  ${String(r.status).padStart(3)} ${verdict}  ${url}`);
    // For 405s, retry with our aggregator UA to see if UA matters
    if (r.status === 405) {
      const r2 = await get(url, "Mozilla/5.0 (compatible; JudysJPNews/1.0)");
      console.log(`      retry w/ bot UA: ${r2.status}`);
    }
  }
}
