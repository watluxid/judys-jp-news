/* Judy's JP News — renders data/articles.json with category tabs + search. */
(() => {
  "use strict";

  const CATEGORIES = [
    { id: "all", label: "すべて", emoji: "🌸" },
    { id: "news", label: "ニュース", emoji: "📰" },
    { id: "cooking", label: "料理", emoji: "🍳" },
    { id: "music", label: "音楽", emoji: "🎵" },
    { id: "otome", label: "乙女ゲーム", emoji: "💜" },
    { id: "documentary", label: "ドキュメンタリー", emoji: "🐾" },
    { id: "culture", label: "カルチャー", emoji: "🎨" },
  ];
  const LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  const RELOAD_EVERY_MS = 20 * 60 * 1000; // re-fetch data while the tab stays open

  const els = {
    tabs: document.getElementById("tabs"),
    grid: document.getElementById("articles"),
    search: document.getElementById("search"),
    updatedAt: document.getElementById("updated-at"),
    resultCount: document.getElementById("result-count"),
    emptyState: document.getElementById("empty-state"),
    emptyMessage: document.getElementById("empty-message"),
  };

  const state = { articles: [], generatedAt: null, category: "all", query: "" };

  function timeAgo(iso) {
    if (!iso) return "";
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
    if (mins < 60) return `${mins}分前`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}時間前`;
    const days = Math.round(hours / 24);
    if (days < 8) return `${days}日前`;
    const d = new Date(iso);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function isNew(iso) {
    return iso && Date.now() - new Date(iso) < 12 * 3600 * 1000;
  }

  function renderTabs() {
    els.tabs.replaceChildren(
      ...CATEGORIES.map((cat) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tab" + (state.category === cat.id ? " active" : "");
        const n =
          cat.id === "all"
            ? state.articles.length
            : state.articles.filter((a) => a.category === cat.id).length;
        btn.innerHTML = `${cat.emoji} ${cat.label}<span class="count">${n}</span>`;
        btn.addEventListener("click", () => {
          state.category = cat.id;
          render();
        });
        return btn;
      })
    );
  }

  function matchesQuery(a, q) {
    return (a.title + " " + a.summary + " " + a.source).toLowerCase().includes(q);
  }

  function buildCard(a) {
    const card = document.createElement("a");
    card.className = "card";
    card.href = a.url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    const cat = LABELS[a.category] || { label: a.category, emoji: "✨" };
    const top = document.createElement("div");
    top.className = "card-top";
    const chip = document.createElement("span");
    chip.className = `chip ${a.category}`;
    chip.textContent = `${cat.emoji} ${cat.label}`;
    top.append(chip);
    if (isNew(a.date)) {
      const badge = document.createElement("span");
      badge.className = "badge-new";
      badge.textContent = "NEW";
      top.append(badge);
    }

    const h2 = document.createElement("h2");
    h2.textContent = a.title;

    const bottom = document.createElement("div");
    bottom.className = "card-bottom";
    const source = document.createElement("span");
    source.className = "source";
    source.textContent = a.source;
    const time = document.createElement("span");
    time.textContent = timeAgo(a.date);
    bottom.append(source, time);

    card.append(top, h2);
    if (a.summary) {
      const p = document.createElement("p");
      p.className = "summary";
      p.textContent = a.summary;
      card.append(p);
    }
    card.append(bottom);
    return card;
  }

  function render() {
    renderTabs();
    const q = state.query.trim().toLowerCase();
    const shown = state.articles.filter(
      (a) =>
        (state.category === "all" || a.category === state.category) &&
        (!q || matchesQuery(a, q))
    );

    els.grid.replaceChildren(...shown.map(buildCard));
    els.resultCount.textContent = `${shown.length}件の記事`;
    els.updatedAt.textContent = state.generatedAt
      ? `最終更新: ${timeAgo(state.generatedAt)}（${new Date(
          state.generatedAt
        ).toLocaleString("ja-JP")}）`
      : "";

    const empty = shown.length === 0;
    els.emptyState.hidden = !empty;
    els.grid.hidden = empty;
    if (empty) {
      els.emptyMessage.innerHTML =
        state.articles.length === 0
          ? "まだ記事がありません。<br>ローカルでは <code>npm run fetch</code> を実行してね。<br>GitHub上ではActionsが自動で集めてくれます 🌿"
          : "この条件に合う記事は見つかりませんでした。<br>ことばを変えてためしてみてね 💜";
    }
  }

  async function loadData() {
    try {
      const res = await fetch(`data/articles.json?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.articles = Array.isArray(data.articles) ? data.articles : [];
      state.generatedAt = data.generatedAt || null;
    } catch (e) {
      console.warn("articles.json の読み込みに失敗:", e);
    }
    render();
  }

  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    render();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadData();
  });
  setInterval(loadData, RELOAD_EVERY_MS);

  loadData();
})();
