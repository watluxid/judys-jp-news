#!/usr/bin/env node
/**
 * Fetches all feeds in feeds.json, filters and dedupes articles,
 * and writes data/articles.json for the site to render.
 *
 * Zero dependencies — needs only Node 18+ (global fetch).
 * Usage: node scripts/fetch.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_AGE_DAYS = 14;
const FETCH_TIMEOUT_MS = 20000;
const CONCURRENCY = 6;
const USER_AGENT =
  "Mozilla/5.0 (compatible; JudysJPNews/1.0; +https://github.com/watluxid/judys-jp-news)";

// Sites we never link to (per site policy: no Yahoo, no paywalled hosts).
const BLOCKED_HOSTS = [
  "yahoo.co.jp",
  "news.yahoo.com",
  "nikkei.com",       // paywall
  "asahi.com",        // metered paywall
  "yomiuri.co.jp",    // metered paywall
  "mainichi.jp",      // metered paywall
];

// Topics the site intentionally skips (sports, markets/economy).
const EXCLUDE_TITLE_PATTERNS = [
  /プロ野球|野球|甲子園|サッカー|Jリーグ|J1|J2|ワールドカップ|W杯|メジャーリーグ|大リーグ|MLB|NPB/,
  /ゴルフ|テニス|卓球|バレーボール|バスケットボール|Bリーグ|ラグビー|相撲|大相撲|柔道|フィギュアスケート|駅伝|マラソン大会/,
  /五輪|オリンピック|パラリンピック|アジア大会|グランプリシリーズ/,
  /株価|日経平均|株式市場|東証|為替|円相場|円安|円高|金利|利上げ|利下げ|日銀|GDP|景気|決算|株主総会|投資信託|仮想通貨|ビットコイン/,
];

// Low-quality signals: clickbait-ish or ad-ish titles.
const LOW_QUALITY_PATTERNS = [
  /PR[:：]|広告|アフィリエイト|プレゼント応募|懸賞|クーポン|セール情報|お得情報|ポイ活/,
  /閲覧注意|衝撃|激ヤバ|ヤバすぎ|炎上した?まとめ/,
];

const decoderCache = new Map();
function getDecoder(label) {
  const key = label.toLowerCase();
  if (!decoderCache.has(key)) {
    try {
      decoderCache.set(key, new TextDecoder(key));
    } catch {
      decoderCache.set(key, new TextDecoder("utf-8"));
    }
  }
  return decoderCache.get(key);
}

function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripCdata(s) {
  return s ? s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1") : "";
}

function stripHtml(s) {
  return decodeEntities(stripCdata(s).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function firstTag(block, names) {
  for (const name of names) {
    const m = block.match(
      new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i")
    );
    if (m && m[1].trim()) return m[1].trim();
  }
  return "";
}

function extractLink(block) {
  // Atom-style <link href="..."/>: prefer rel="alternate" or rel-less.
  const linkTags = [...block.matchAll(/<link\b([^>]*?)\/?>(?:<\/link>)?/gi)];
  let candidate = "";
  for (const [, attrs] of linkTags) {
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!href) continue;
    const rel = attrs.match(/rel\s*=\s*["']([^"']+)["']/i);
    if (!rel || rel[1] === "alternate") return decodeEntities(href[1]);
    if (!candidate) candidate = decodeEntities(href[1]);
  }
  // RSS-style <link>https://...</link>
  const m = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
  if (m) {
    const text = stripHtml(m[1]);
    if (text) return text;
  }
  return candidate;
}

function parseFeed(xml) {
  const channelTitle = stripHtml(
    firstTag(xml.replace(/<(item|entry)[\s\S]*$/i, ""), ["title"])
  );
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ];
  const items = [];
  for (const [, block] of blocks) {
    const title = stripHtml(firstTag(block, ["title"]));
    const url = extractLink(block);
    const dateRaw = firstTag(block, [
      "pubDate",
      "dc:date",
      "published",
      "updated",
      "date",
    ]);
    const summary = stripHtml(
      firstTag(block, ["description", "summary", "content:encoded", "content"])
    );
    if (!title || !url) continue;
    const date = dateRaw ? new Date(stripHtml(dateRaw)) : null;
    items.push({
      title,
      url,
      date: date && !isNaN(date) ? date.toISOString() : null,
      summary: summary.slice(0, 220),
    });
  }
  return { channelTitle, items };
}

async function fetchXml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let text = getDecoder("utf-8").decode(buf);
    const enc = text.slice(0, 200).match(/encoding\s*=\s*["']([\w-]+)["']/i);
    if (enc && !/^utf-?8$/i.test(enc[1])) {
      text = getDecoder(enc[1]).decode(buf);
    }
    if (!/<(rss|feed|rdf)[\s:>]/i.test(text.slice(0, 2000))) {
      throw new Error("not an RSS/Atom document");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function isBlockedHost(url) {
  try {
    const host = new URL(url).hostname;
    return BLOCKED_HOSTS.some((b) => host === b || host.endsWith("." + b));
  } catch {
    return true; // unparseable URL → drop
  }
}

function hasJapaneseText(s) {
  return /[぀-ヿ一-鿿]/.test(s);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    // strip tracking params
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|source$)/.test(p)) u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return url;
  }
}

async function processFeed(feed) {
  const errors = [];
  for (const url of feed.urls) {
    try {
      const xml = await fetchXml(url);
      const { items } = parseFeed(xml);
      if (items.length === 0) throw new Error("feed parsed but has no items");
      return { feed, ok: true, url, items, errors };
    } catch (e) {
      errors.push(`${url} → ${e.message}`);
    }
  }
  return { feed, ok: false, url: null, items: [], errors };
}

async function main() {
  const { feeds } = JSON.parse(readFileSync(path.join(ROOT, "feeds.json"), "utf8"));

  // fetch with limited concurrency
  const results = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, feeds.length) }, async () => {
      while (cursor < feeds.length) {
        const feed = feeds[cursor++];
        const r = await processFeed(feed);
        results.push(r);
        console.log(
          r.ok
            ? `✓ ${feed.name} (${r.items.length} items via ${r.url})`
            : `✗ ${feed.name}\n    ${r.errors.join("\n    ")}`
        );
      }
    })
  );

  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000;
  const seenUrls = new Set();
  const seenTitles = new Set();
  const articles = [];

  for (const r of results) {
    if (!r.ok) continue;
    const { feed } = r;
    let kept = 0;
    for (const item of r.items) {
      if (kept >= (feed.maxItems ?? 8)) break;
      const url = normalizeUrl(item.url);
      const titleKey = item.title.replace(/\s+/g, "").toLowerCase();
      if (seenUrls.has(url) || seenTitles.has(titleKey)) continue;
      if (isBlockedHost(url)) continue;
      if (item.date && new Date(item.date).getTime() < cutoff) continue;
      if (!hasJapaneseText(item.title + item.summary)) continue; // Japanese-only site
      const haystack = item.title + " " + item.summary;
      if (EXCLUDE_TITLE_PATTERNS.some((p) => p.test(item.title))) continue;
      if (LOW_QUALITY_PATTERNS.some((p) => p.test(item.title))) continue;
      if (
        feed.includeKeywords &&
        !feed.includeKeywords.some((k) =>
          haystack.toLowerCase().includes(k.toLowerCase())
        )
      )
        continue;
      seenUrls.add(url);
      seenTitles.add(titleKey);
      articles.push({
        title: item.title,
        url,
        date: item.date,
        summary: item.summary,
        source: feed.name,
        sourceHomepage: feed.homepage,
        category: feed.category,
      });
      kept++;
    }
  }

  // newest first; undated items sink to the bottom of their insertion order
  articles.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const out = {
    generatedAt: new Date().toISOString(),
    articleCount: articles.length,
    feedStatus: results
      .map((r) => ({
        name: r.feed.name,
        category: r.feed.category,
        ok: r.ok,
        usedUrl: r.url,
        errors: r.errors,
      }))
      .sort((a, b) => Number(a.ok) - Number(b.ok)),
    articles,
  };

  mkdirSync(path.join(ROOT, "data"), { recursive: true });
  writeFileSync(
    path.join(ROOT, "data", "articles.json"),
    JSON.stringify(out, null, 2) + "\n"
  );

  const okCount = results.filter((r) => r.ok).length;
  console.log(
    `\nWrote data/articles.json — ${articles.length} articles from ${okCount}/${feeds.length} feeds.`
  );
  if (okCount === 0) {
    console.error("All feeds failed — check network access.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
