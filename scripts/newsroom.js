import { escapeHtml } from "./utils.js";

const root = document.getElementById("vivid-editorial-feed");
if (root) {
  const filters = document.querySelectorAll("[data-editorial-filter]");
  const status = document.getElementById("vivid-editorial-status");
  let activeFilter = "all";
  let articles = [];

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
  function card(article, featured = false) {
    const url = safeUrl(article.sourceUrl);
    const title = escapeHtml(article.headline || "Entertainment news");
    const publisher = escapeHtml(article.publisher || "Original publisher");
    const region = labelFor(article.region);
    const category = labelFor(article.category);
    const link = url || safeUrl(article.publisherUrl) || "https://news.google.com/";
    return '<article class="vivid-editorial-card' + (featured ? ' is-featured' : '') + '">' +
      '<a class="vivid-editorial-art vivid-editorial-art-placeholder" href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer" aria-label="Read original story"><span>VIVID / NEWS</span></a>' +
      '<div class="vivid-editorial-card-copy"><div class="vivid-editorial-meta"><span>' + escapeHtml(category) + '</span><span>' + publisher + '</span></div>' +
      '<h3><a href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer">' + title + '</a></h3>' +
      '<p>Reported by ' + publisher + '. Open the original report to read the full story.</p>' +
      '<div class="vivid-editorial-foot"><time>' + escapeHtml(formatDate(article.publishedAt)) + '</time><a href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer">Read original <span aria-hidden="true">↗</span></a></div></div></article>';
  }
  function render() {
    const filtered = articles.filter(article => matchesFilter(article, activeFilter));
    if (!filtered.length) {
      root.setAttribute("aria-busy","false");
      root.innerHTML = '<div class="vivid-editorial-empty"><span class="vivid-editorial-empty-mark">V</span><h3>No stories in this section yet.</h3><p>Try Global or another region. The feed refreshes automatically from public news RSS results.</p></div>';
      return;
    }
    const cards = filtered.slice(0,30).map((article,index)=>card(article,index===0)).join("");
    root.innerHTML = '<div class="vivid-editorial-grid">' + cards + '</div>';
    root.setAttribute("aria-busy","false");
  }
  filters.forEach(button => button.addEventListener("click", () => {
    activeFilter = button.dataset.editorialFilter || "all";
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
      root.innerHTML = '<div class="vivid-editorial-empty"><h3>The live web-news feed has not been generated yet.</h3><p>Open the repository Actions tab and run “Refresh Vivid Cinema web news”. Once the first feed is generated, stories will appear here automatically.</p><a href="https://github.com/sensorylog/vivid-cinema/actions/workflows/refresh-static-news.yml" target="_blank" rel="noopener noreferrer">Open news feed workflow ↗</a></div>';
      if (status) status.textContent = "Waiting for first web-news refresh";
    });
}
