# 🍵 Judy's JP News

日本語のいいよみもの、あつめました ・ᴗ・

A cute pastel (light mauve × mint green) news aggregator for **high-quality, Japanese-language articles** — no paywalls, no subscriptions, no Yahoo! News, and no sites that require a Japanese IP address.

## Topics

| Tab | What's inside |
|---|---|
| 📰 ニュース | NHK news (general, society, science & culture, world) — sports & market/economy items are filtered out |
| 🍳 料理 | Cookpad News, つくおき, 樋口直哉's cooking-science notes, 白ごはん.com |
| 🎵 音楽 | 音楽ナタリー, Mikiki (Tower Records), amass |
| 💜 乙女ゲーム | B's-LOG, plus otome-related items keyword-filtered from general game sites |
| 🐾 ドキュメンタリー | National Geographic 日本版, sorae (space), ナゾロジー, カラパイア (animals), デイリーポータルZ (places & field reports) |
| 🎨 カルチャー | 美術手帖, 和樂web, コミックナタリー, ステージナタリー, CINRA, ほんのひきだし |

## How quality filtering works

`scripts/fetch.mjs` pulls every feed in [`feeds.json`](feeds.json) and then:

- **drops** anything linking to Yahoo! or paywalled newspapers (Nikkei, Asahi, Yomiuri, Mainichi)
- **drops** sports and stock-market/economy items by keyword
- **drops** clickbait/ad-flavored titles (PR, プレゼント応募, 閲覧注意, …)
- **keeps only Japanese-language** items, deduplicates by URL and title, keeps the last 14 days
- caps each source (so one chatty feed can't flood the page) and sorts newest-first

Feeds can list several candidate URLs; the fetcher tries them in order and records dead feeds in `data/articles.json → feedStatus`, so you can spot and fix broken sources easily.

## Preview locally

Requires only **Node.js 18+** — no npm install needed.

```bash
npm run fetch   # pull fresh articles → data/articles.json
npm run serve   # serve the site at http://localhost:8787
# or both in one go:
npm start
```

## Automatic refresh

- **GitHub Actions** ([`.github/workflows/refresh.yml`](.github/workflows/refresh.yml)) re-fetches all feeds **every 6 hours** (and on demand via *Run workflow*), commits the new `data/articles.json`, and deploys the site to **GitHub Pages**.
- While the page is open in a browser it silently re-loads the data every 20 minutes (and whenever the tab regains focus).

> If the Pages deploy step fails on the first run, enable it once by hand: **Settings → Pages → Source: GitHub Actions**. The data refresh itself is unaffected.

## Adding / removing sources

Edit [`feeds.json`](feeds.json). Each entry looks like:

```jsonc
{
  "name": "美術手帖",                       // shown on the card
  "homepage": "https://bijutsutecho.com/",
  "category": "culture",                    // news | cooking | music | otome | documentary | culture
  "urls": ["https://bijutsutecho.com/feed"],// candidates, tried in order
  "maxItems": 8,                            // per-refresh cap (optional)
  "includeKeywords": ["乙女ゲーム"]          // optional: keep only matching items
}
```

Made with 💜 & 🌿
