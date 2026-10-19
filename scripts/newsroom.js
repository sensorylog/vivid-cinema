import { escapeHtml } from "./utils.js";

const root = document.getElementById("vivid-editorial-feed");
if (root) {
  const filters = [...document.querySelectorAll("[data-editorial-filter]")];
  const status = document.getElementById("vivid-editorial-status");
  let activeFilter = "all";
  let articles = [];
  let visibleCount = 12;
  let lastTrigger = null;

  const labelFor = value => ({
    film:"Film", television:"TV", streaming:"Streaming", celebrity:"People", music:"Music",
    gaming:"Gaming", anime:"Anime", animation:"Animation", "box-office":"Box office",
    festivals:"Festivals", production:"Production", business:"Business", legal:"Legal",
    awards:"Awards", ghana:"Ghana", nollywood:"Nollywood", africa:"Africa",
    asia:"Asia", india:"India", hollywood:"Hollywood", global:"Global",
    europe:"Europe", "latin-america":"Latin America", "middle-east":"Middle East"
  }[value] || "Entertainment");

  const regionAliases = {
    hollywood:["hollywood","us","usa","united-states","north-america"],
    india:["india","south-asia"],
    africa:["africa","west-africa","east-africa","south-africa","ghana","nigeria","nollywood"],
    asia:["asia","east-asia","southeast-asia","south-asia","india","japan","korea"],
    europe:["europe","uk","united-kingdom","france","germany","italy","spain"],
    "latin-america":["latin-america","south-america","central-america","mexico","brazil"],
    "middle-east":["middle-east","mena","saudi-arabia","united-arab-emirates"]
  };

  function matchesFilter(article, filter) {
    if (filter === "all") return true;
    const region = String(article.region || "").toLowerCase();
    const category = String(article.category || "").toLowerCase();
    if (region === filter || category === filter) return true;
    return (regionAliases[filter] || []).includes(region);
  }
  function cleanSummary(value, publisher = "") {
    let summary = String(value || "")
      .replace(/&(?:nbsp|#160|#xA0);/gi, " ")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (publisher && summary.toLowerCase().endsWith(publisher.toLowerCase())) {
      summary = summary.slice(0, -publisher.length).replace(/[\s|–—-]+$/, "").trim();
    }
    return summary;
  }
  function formatDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
      ? new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",year:"numeric"}).format(date)
      : "Recently reported";
  }
  function safeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "";
    } catch { return ""; }
  }
  function ensureReader() {
    let modal = document.getElementById("vivid-news-reader");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "vivid-news-reader";
    modal.className = "vivid-news-reader";
    modal.hidden = true;
    modal.setAttribute("role","dialog");
    modal.setAttribute("aria-modal","true");
    modal.setAttribute("aria-labelledby","vivid-news-reader-title");
    modal.innerHTML = '<div class="vivid-news-reader-backdrop" data-reader-close></div><section class="vivid-news-reader-panel" role="document"><header class="vivid-news-reader-header"><span class="vivid-news-reader-mark">VIVID / NEWS</span><button type="button" class="vivid-news-reader-close" data-reader-close aria-label="Close article reader">×</button></header><figure class="vivid-news-reader-image-wrap" id="vivid-news-reader-image-wrap" hidden><img id="vivid-news-reader-image" alt="" decoding="async"></figure><div class="vivid-news-reader-content"><div class="vivid-news-reader-meta" id="vivid-news-reader-meta"></div><h2 id="vivid-news-reader-title"></h2><p class="vivid-news-reader-summary" id="vivid-news-reader-summary"></p><div class="vivid-news-reader-footer"><span id="vivid-news-reader-date"></span><a id="vivid-news-reader-original" target="_blank" rel="noopener noreferrer">Continue at publisher <span aria-hidden="true">↗</span></a></div></div></section>';
    document.body.append(modal);
    modal.addEventListener("click", event => {
      if (event.target.closest("[data-reader-close]")) closeReader();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !modal.hidden) closeReader();
    });
    return modal;
  }
  function openReader(article, trigger) {
    const url = safeUrl(article.sourceUrl);
    if (!url) return;
    lastTrigger = trigger || document.activeElement;
    const modal = ensureReader();
    const publisher = article.publisher || "Original publisher";
    document.getElementById("vivid-news-reader-meta").textContent =
      labelFor(article.category) + "  /  " + publisher;
    document.getElementById("vivid-news-reader-title").textContent = article.headline || "Entertainment news";
    document.getElementById("vivid-news-reader-summary").textContent =
      cleanSummary(article.summary, publisher) || "This publisher’s RSS feed did not include a readable summary. Open the original report for the complete story.";
    document.getElementById("vivid-news-reader-date").textContent = formatDate(article.publishedAt);
    const imageUrl = safeUrl(article.imageUrl);
    const imageWrap = document.getElementById("vivid-news-reader-image-wrap");
    const readerImage = document.getElementById("vivid-news-reader-image");
    if (imageUrl) {
      readerImage.onerror = () => { imageWrap.hidden = true; readerImage.removeAttribute("src"); };
      readerImage.src = imageUrl;
      imageWrap.hidden = false;
    } else {
      readerImage.removeAttribute("src");
      imageWrap.hidden = true;
    }
    const original = document.getElementById("vivid-news-reader-original");
    original.href = url;
    original.setAttribute("aria-label","Continue reading at " + publisher);
    modal.hidden = false;
    document.body.classList.add("vivid-news-reader-open");
    modal.querySelector(".vivid-news-reader-close").focus();
  }
  function closeReader() {
    const modal = document.getElementById("vivid-news-reader");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove("vivid-news-reader-open");
    lastTrigger?.focus?.();
  }
  function card(article, featured = false) {
    const url = safeUrl(article.sourceUrl);
    const title = escapeHtml(article.headline || "Entertainment news");
    const publisher = escapeHtml(article.publisher || "Original publisher");
    const category = labelFor(article.category);
    const summary = escapeHtml(cleanSummary(article.summary, article.publisher) || "This publisher has not provided a preview. Open the original report for the full story.");
    const source = url || safeUrl(article.publisherUrl) || "https://news.google.com/";
    const imageUrl = safeUrl(article.imageUrl);
    const id = escapeHtml(article.id || "");
    const artContent = imageUrl
      ? '<img src="' + escapeHtml(imageUrl) + '" alt="" aria-hidden="true" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="vivid-editorial-image-label">VIVID / NEWS</span><strong class="vivid-editorial-art-category">' + escapeHtml(category) + '</strong>'
      : '<span class="vivid-editorial-image-label">VIVID / NEWS</span><strong class="vivid-editorial-art-category">' + escapeHtml(category) + '</strong>';
    return '<article class="vivid-editorial-card' + (featured ? ' is-featured' : '') + '" data-story-id="' + id + '" data-category="' + escapeHtml(article.category || "film") + '">' +
      '<button class="vivid-editorial-art vivid-editorial-open' + (imageUrl ? ' has-image' : ' vivid-editorial-art-placeholder') + '" type="button" data-open-story="' + id + '" aria-label="Read ' + title + ' in Vivid">' + artContent + '<i class="bi bi-arrow-up-right" aria-hidden="true"></i></button>' +
      '<div class="vivid-editorial-card-copy"><div class="vivid-editorial-meta"><span>' + escapeHtml(category) + '</span><span>' + publisher + '</span></div>' +
      '<h3><button type="button" class="vivid-editorial-title-button" data-open-story="' + id + '">' + title + '</button></h3>' +
      '<p>' + summary + '</p>' +
      '<div class="vivid-editorial-foot"><time>' + escapeHtml(formatDate(article.publishedAt)) + '</time><div><button type="button" class="vivid-editorial-read" data-open-story="' + id + '">Read in Vivid</button><a href="' + escapeHtml(source) + '" target="_blank" rel="noopener noreferrer">Original ↗</a></div></div></div></article>';
  }
  function render() {
    const filtered = articles.filter(article => matchesFilter(article, activeFilter));
    if (!filtered.length) {
      root.setAttribute("aria-busy","false");
      root.innerHTML = '<div class="vivid-editorial-empty"><span class="vivid-editorial-empty-mark">V</span><h3>No stories in this section yet.</h3><p>Try Global or another topic. The feed refreshes automatically from public news RSS sources.</p></div>';
      return;
    }
    root.innerHTML = '<div class="vivid-editorial-count">' + filtered.length + ' stories in this view</div><div class="vivid-editorial-grid">' + filtered.slice(0,visibleCount).map((article,index)=>card(article,index===0)).join("") + '</div>' + (filtered.length > visibleCount ? '<div class="vivid-editorial-more-wrap"><button type="button" class="vivid-editorial-more" data-load-more>Load more stories <span>' + Math.min(12, filtered.length-visibleCount) + ' more</span></button></div>' : '');
    root.setAttribute("aria-busy","false");
  }
  root.addEventListener("error", event => {
    if (!event.target.matches(".vivid-editorial-art img")) return;
    const art = event.target.closest(".vivid-editorial-art");
    event.target.remove();
    art?.classList.remove("has-image");
    art?.classList.add("vivid-editorial-art-placeholder");
  }, true);
  root.addEventListener("click", event => {
    const more = event.target.closest("[data-load-more]");
    if (more) { visibleCount += 12; render(); return; }
    const button = event.target.closest("[data-open-story]");
    const cardElement = event.target.closest(".vivid-editorial-card");
    if (!button && (!cardElement || event.target.closest("a,button"))) return;
    const storyId = button?.dataset.openStory || cardElement?.dataset.storyId;
    const article = articles.find(item => String(item.id || "") === storyId);
    if (article) openReader(article, button || cardElement);
  });
  filters.forEach(button => button.addEventListener("click", () => {
    activeFilter = button.dataset.editorialFilter || "all";
    visibleCount = 12;
    filters.forEach(item => {
      const active = item.dataset.editorialFilter === activeFilter;
      item.classList.toggle("is-active",active);
      item.setAttribute("aria-pressed",active ? "true" : "false");
    });
    render();
  }));

  fetch("./data/news-feed.json",{cache:"no-store"})
    .then(response => {
      if (!response.ok) throw new Error("Static news feed returned HTTP " + response.status);
      return response.json();
    })
    .then(data => {
      articles = Array.isArray(data.articles) ? data.articles : [];
      render();
      if (status) {
        const time = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "recently";
        status.textContent = articles.length + " web headlines · updated " + time;
      }
    })
    .catch(error => {
      console.error("Vivid static news feed unavailable:",error);
      root.setAttribute("aria-busy","false");
      root.innerHTML = '<div class="vivid-editorial-empty"><h3>The web-news feed is temporarily unavailable.</h3><p>Try again shortly. The newsroom refreshes automatically from public news RSS sources.</p><button type="button" class="vivid-editorial-retry" id="vivid-news-retry">Try again</button></div>';
      document.getElementById("vivid-news-retry")?.addEventListener("click", () => location.reload());
      if (status) status.textContent = "News feed unavailable · retry";
    });
}
