import { escapeHtml } from "./utils.js";

/**
 * Vivid Newsroom — public editorial desk (static feed).
 * Scope: cards, filters, image thumbnails, in-app "Vivid Read" modal only.
 * Does not touch TMDB release radar (news.js), moderated pipeline, or other pages.
 */
const root = document.getElementById("vivid-editorial-feed");
if (root) {
  const filters = [...document.querySelectorAll("[data-editorial-filter]")];
  const status = document.getElementById("vivid-editorial-status");
  let activeFilter = "all";
  let articles = [];
  let visibleCount = 12;
  let lastTrigger = null;
  let lastGeneratedAt = "";

  const labelFor = value => ({
    film: "Film", television: "TV", streaming: "Streaming", celebrity: "People", music: "Music",
    gaming: "Gaming", anime: "Anime", animation: "Animation", "box-office": "Box office",
    festivals: "Festivals", production: "Production", business: "Business", legal: "Legal",
    awards: "Awards", ghana: "Ghana", nollywood: "Nollywood", africa: "Africa",
    asia: "Asia", india: "India", hollywood: "Hollywood", global: "Global",
    europe: "Europe", "latin-america": "Latin America", "middle-east": "Middle East"
  }[value] || "Entertainment");

  const regionAliases = {
    hollywood: ["hollywood", "us", "usa", "united-states", "north-america"],
    india: ["india", "south-asia"],
    africa: ["africa", "west-africa", "east-africa", "south-africa", "ghana", "nigeria", "nollywood"],
    asia: ["asia", "east-asia", "southeast-asia", "south-asia", "india", "japan", "korea"],
    europe: ["europe", "uk", "united-kingdom", "france", "germany", "italy", "spain"],
    "latin-america": ["latin-america", "south-america", "central-america", "mexico", "brazil"],
    "middle-east": ["middle-east", "mena", "saudi-arabia", "united-arab-emirates"]
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
    if (!summary) return "";
    if (publisher) {
      const pub = publisher.trim();
      if (pub && summary.toLowerCase().endsWith(pub.toLowerCase())) {
        summary = summary.slice(0, -pub.length).replace(/[\s|–—\-·•]+$/u, "").trim();
      }
    }
    summary = summary.replace(/\s*[-–—]\s*[A-Z][A-Za-z0-9 .&']{2,40}\s*$/u, "").trim();
    return summary;
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "Recently reported";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
  }

  function relativeTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "Recently";
    const seconds = Math.round((Date.now() - date.getTime()) / 1000);
    if (seconds < 0) return "Just now";
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
    if (seconds < 172800) return "Yesterday";
    if (seconds < 604800) return Math.floor(seconds / 86400) + "d ago";
    return formatDate(value);
  }

  function publisherDomain(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, "");
      return host || "";
    } catch {
      return "";
    }
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function safeImageUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (url.origin === location.origin && url.pathname.startsWith("/data/news-thumbnails/")) return url.href;
      if (url.origin === location.origin && url.pathname.startsWith("./data/news-thumbnails/")) return url.href;
      if (String(value || "").startsWith("./data/news-thumbnails/") || String(value || "").startsWith("/data/news-thumbnails/")) {
        return new URL(value, location.href).href;
      }
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function ensureReader() {
    let modal = document.getElementById("vivid-news-reader");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "vivid-news-reader";
    modal.className = "vivid-news-reader";
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "vivid-news-reader-title");
    modal.innerHTML =
      '<div class="vivid-news-reader-backdrop" data-reader-close></div>' +
      '<section class="vivid-news-reader-panel" role="document">' +
        '<header class="vivid-news-reader-header">' +
          '<span class="vivid-news-reader-mark">VIVID · NEWSROOM</span>' +
          '<button type="button" class="vivid-news-reader-close" data-reader-close aria-label="Close article reader">×</button>' +
        '</header>' +
        '<figure class="vivid-news-reader-image-wrap" id="vivid-news-reader-image-wrap" hidden>' +
          '<img id="vivid-news-reader-image" alt="" decoding="async">' +
          '<figcaption id="vivid-news-reader-caption" class="vivid-news-reader-caption" hidden></figcaption>' +
        '</figure>' +
        '<div class="vivid-news-reader-content">' +
          '<div class="vivid-news-reader-meta" id="vivid-news-reader-meta"></div>' +
          '<h2 id="vivid-news-reader-title"></h2>' +
          '<p class="vivid-news-reader-dek" id="vivid-news-reader-dek" hidden></p>' +
          '<p class="vivid-news-reader-summary" id="vivid-news-reader-summary"></p>' +
          '<p class="vivid-news-reader-note">Vivid surfaces attributed headlines from public news feeds. This is a brief, not a full reprint. Always open the original for the complete report.</p>' +
          '<div class="vivid-news-reader-footer">' +
            '<div class="vivid-news-reader-footer-meta">' +
              '<span id="vivid-news-reader-date"></span>' +
              '<span id="vivid-news-reader-domain" class="vivid-news-reader-domain"></span>' +
            '</div>' +
            '<a id="vivid-news-reader-original" class="vivid-news-reader-cta" target="_blank" rel="noopener noreferrer">Continue at publisher <span aria-hidden="true">↗</span></a>' +
          '</div>' +
        '</div>' +
      '</section>';
    document.body.append(modal);

    modal.addEventListener("click", event => {
      if (event.target.closest("[data-reader-close]")) closeReader();
    });
    modal.addEventListener("keydown", event => {
      if (event.key !== "Tab" || modal.hidden) return;
      const focusable = [...modal.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
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
    const category = labelFor(article.category);
    const region = labelFor(article.region);
    const summary = cleanSummary(article.summary, publisher);
    const domain = publisherDomain(url);

    document.getElementById("vivid-news-reader-meta").textContent =
      [category, region !== "Entertainment" && region !== category ? region : null, publisher]
        .filter(Boolean)
        .join("  ·  ");

    document.getElementById("vivid-news-reader-title").textContent = article.headline || "Entertainment news";

    const dek = document.getElementById("vivid-news-reader-dek");
    dek.hidden = true;

    const summaryEl = document.getElementById("vivid-news-reader-summary");
    summaryEl.textContent = summary ||
      "This publisher’s feed did not include a readable summary. Open the original report for the complete story.";

    document.getElementById("vivid-news-reader-date").textContent =
      relativeTime(article.publishedAt) + " · " + formatDate(article.publishedAt);

    const domainEl = document.getElementById("vivid-news-reader-domain");
    if (domainEl) domainEl.textContent = domain ? domain : "";

    const imageUrl = safeImageUrl(article.imageUrl);
    const imageFallbackUrl = safeImageUrl(article.imageFallbackUrl);
    const imageWrap = document.getElementById("vivid-news-reader-image-wrap");
    const readerImage = document.getElementById("vivid-news-reader-image");
    const caption = document.getElementById("vivid-news-reader-caption");

    if (imageUrl) {
      readerImage.alt = (article.headline || "Story image").slice(0, 120);
      readerImage.dataset.fallbackSrc = imageFallbackUrl || "";
      readerImage.onerror = () => {
        const fallback = readerImage.dataset.fallbackSrc;
        if (fallback && readerImage.src !== fallback && !readerImage.dataset.fallbackTried) {
          readerImage.dataset.fallbackTried = "true";
          readerImage.src = fallback;
          return;
        }
        imageWrap.hidden = true;
        readerImage.removeAttribute("src");
        if (caption) caption.hidden = true;
      };
      delete readerImage.dataset.fallbackTried;
      readerImage.src = imageUrl;
      imageWrap.hidden = false;
      if (caption) {
        caption.textContent = publisher + (domain ? " · " + domain : "");
        caption.hidden = false;
      }
    } else {
      readerImage.removeAttribute("src");
      readerImage.removeAttribute("alt");
      delete readerImage.dataset.fallbackSrc;
      delete readerImage.dataset.fallbackTried;
      imageWrap.hidden = true;
      if (caption) caption.hidden = true;
    }

    const original = document.getElementById("vivid-news-reader-original");
    original.href = url;
    original.setAttribute("aria-label", "Continue reading at " + publisher);

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
    const summary = escapeHtml(
      cleanSummary(article.summary, article.publisher) ||
      "Open the original report for the full story."
    );
    const source = url || safeUrl(article.publisherUrl) || "https://news.google.com/";
    const imageUrl = safeImageUrl(article.imageUrl);
    const imageFallbackUrl = safeImageUrl(article.imageFallbackUrl);
    const imageFallbackAttr = imageFallbackUrl
      ? ' data-fallback-src="' + escapeHtml(imageFallbackUrl) + '"'
      : "";
    const id = escapeHtml(article.id || "");
    const when = escapeHtml(relativeTime(article.publishedAt));
    const artContent = imageUrl
      ? '<img src="' + escapeHtml(imageUrl) + '"' + imageFallbackAttr +
        ' alt="" aria-hidden="true" loading="lazy" decoding="async">' +
        '<span class="vivid-editorial-image-label">VIVID</span>' +
        '<strong class="vivid-editorial-art-category">' + escapeHtml(category) + "</strong>"
      : '<span class="vivid-editorial-image-label">VIVID</span>' +
        '<strong class="vivid-editorial-art-category">' + escapeHtml(category) + "</strong>";

    return (
      '<article class="vivid-editorial-card' + (featured ? " is-featured" : "") +
      '" data-story-id="' + id + '" data-category="' + escapeHtml(article.category || "film") + '">' +
      '<button class="vivid-editorial-art vivid-editorial-open' +
      (imageUrl ? " has-image" : " vivid-editorial-art-placeholder") +
      '" type="button" data-open-story="' + id + '" aria-label="Read ' + title + ' in Vivid">' +
      artContent +
      '<i class="bi bi-arrow-up-right" aria-hidden="true"></i></button>' +
      '<div class="vivid-editorial-card-copy">' +
      '<div class="vivid-editorial-meta"><span>' + escapeHtml(category) +
      "</span><span>" + publisher + "</span><span>" + when + "</span></div>" +
      '<h3><button type="button" class="vivid-editorial-title-button" data-open-story="' + id + '">' +
      title + "</button></h3>" +
      "<p>" + summary + "</p>" +
      '<div class="vivid-editorial-foot">' +
      "<time datetime=\"" + escapeHtml(article.publishedAt || "") + "\">" + escapeHtml(formatDate(article.publishedAt)) + "</time>" +
      "<div>" +
      '<button type="button" class="vivid-editorial-read" data-open-story="' + id + '">Read in Vivid</button>' +
      '<a href="' + escapeHtml(source) + '" target="_blank" rel="noopener noreferrer">Original ↗</a>' +
      "</div></div></div></article>"
    );
  }

  function render() {
    const filtered = articles.filter(article => matchesFilter(article, activeFilter));
    if (!filtered.length) {
      root.setAttribute("aria-busy", "false");
      root.innerHTML =
        '<div class="vivid-editorial-empty">' +
        '<span class="vivid-editorial-empty-mark">V</span>' +
        "<h3>No stories in this section yet.</h3>" +
        "<p>Try Global or another topic. The desk refreshes automatically from public news feeds.</p>" +
        "</div>";
      return;
    }
    const moreCount = Math.min(12, filtered.length - visibleCount);
    root.innerHTML =
      '<div class="vivid-editorial-count">' + filtered.length + " stories in this view</div>" +
      '<div class="vivid-editorial-grid">' +
      filtered.slice(0, visibleCount).map((article, index) => card(article, index === 0)).join("") +
      "</div>" +
      (filtered.length > visibleCount
        ? '<div class="vivid-editorial-more-wrap">' +
          '<button type="button" class="vivid-editorial-more" data-load-more>Load more stories <span>' +
          moreCount + " more</span></button></div>"
        : "");
    root.setAttribute("aria-busy", "false");
  }

  root.addEventListener("error", event => {
    if (!event.target.matches(".vivid-editorial-art img")) return;
    const art = event.target.closest(".vivid-editorial-art");
    const fallback = event.target.dataset.fallbackSrc;
    if (fallback && event.target.src !== fallback && !event.target.dataset.fallbackTried) {
      event.target.dataset.fallbackTried = "true";
      event.target.src = fallback;
      return;
    }
    event.target.remove();
    art?.classList.remove("has-image");
    art?.classList.add("vivid-editorial-art-placeholder");
  }, true);

  root.addEventListener("click", event => {
    const more = event.target.closest("[data-load-more]");
    if (more) {
      visibleCount += 12;
      render();
      return;
    }
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
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", active ? "true" : "false");
    });
    render();
  }));

  function statusText(count, generatedAt) {
    if (!generatedAt) return count + " headlines · public news feeds";
    const when = relativeTime(generatedAt);
    return count + " headlines · updated " + when + " · auto-refresh on";
  }

  async function loadNewsFeed({ quiet = false } = {}) {
    try {
      const response = await fetch("./data/news-feed.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Static news feed returned HTTP " + response.status);
      const data = await response.json();
      if (!Array.isArray(data.articles)) throw new Error("Static news feed has no article list");
      if (lastGeneratedAt && data.generatedAt === lastGeneratedAt) return;
      articles = data.articles.slice().sort((a, b) => {
        const timeA = Date.parse(a.publishedAt || "");
        const timeB = Date.parse(b.publishedAt || "");
        return (Number.isFinite(timeB) ? timeB : 0) - (Number.isFinite(timeA) ? timeA : 0);
      });
      lastGeneratedAt = data.generatedAt || "";
      render();
      if (status) status.textContent = statusText(articles.length, data.generatedAt);
    } catch (error) {
      if (quiet && articles.length) {
        if (status) status.textContent = "Refresh unavailable · showing last loaded headlines";
        return;
      }
      console.error("Vivid static news feed unavailable:", error);
      if (articles.length) return;
      root.setAttribute("aria-busy", "false");
      root.innerHTML =
        '<div class="vivid-editorial-empty">' +
        "<h3>The web-news feed is temporarily unavailable.</h3>" +
        "<p>Try again shortly. The newsroom refreshes automatically from public news feeds.</p>" +
        '<button type="button" class="vivid-editorial-retry" id="vivid-news-retry">Try again</button>' +
        "</div>";
      document.getElementById("vivid-news-retry")?.addEventListener("click", () => loadNewsFeed());
      if (status) status.textContent = "News feed unavailable · retry";
    }
  }

  loadNewsFeed();
  window.setInterval(() => {
    if (!document.hidden) loadNewsFeed({ quiet: true });
  }, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadNewsFeed({ quiet: true });
  });
}
