import { db } from "./firebase.js";
import { collection, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { escapeHtml } from "./utils.js";

const root = document.getElementById("vivid-editorial-feed");
if (root) {
  const filters = document.querySelectorAll("[data-editorial-filter]");
  let activeFilter = "all";
  let articles = [];
  let unsubscribe = null;

  const labelFor = value => ({
    film: "Film", television: "Television", celebrity: "People", streaming: "Streaming",
    awards: "Awards", ghana: "Ghana", nollywood: "Nollywood", africa: "African cinema",
    trailers: "Trailers", industry: "Industry"
  }[value] || "Entertainment");

  const formatDate = value => {
    const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "Date not provided";
    return new Intl.DateTimeFormat(undefined, {month:"short",day:"numeric",year:"numeric"}).format(date);
  };

  function card(article, featured = false) {
    const title = escapeHtml(article.headline || "Untitled story");
    const source = escapeHtml(article.publisher || "Original publisher");
    const summary = escapeHtml(article.summary || "Read the original report for the full story.");
    const category = labelFor(article.category);
    const href = "news-story.html?id=" + encodeURIComponent(article.id);
    const image = /^https:\/\//i.test(article.imageUrl || "") ? article.imageUrl : "";
    return '<article class="vivid-editorial-card' + (featured ? ' is-featured' : '') + '">' +
      (image ? '<a class="vivid-editorial-art" href="' + href + '"><img src="' + escapeHtml(image) + '" alt="" loading="lazy" decoding="async"></a>' :
        '<a class="vivid-editorial-art vivid-editorial-art-placeholder" href="' + href + '" aria-label="Open story"><span>VIVID / NEWS</span></a>') +
      '<div class="vivid-editorial-card-copy"><div class="vivid-editorial-meta"><span>' + escapeHtml(category) + '</span><span>' + source + '</span></div>' +
      '<h3><a href="' + href + '">' + title + '</a></h3><p>' + summary + '</p>' +
      '<div class="vivid-editorial-foot"><time>' + escapeHtml(formatDate(article.publishedAt)) + '</time><a href="' + href + '">Read & discuss <span aria-hidden="true">↗</span></a></div></div></article>';
  }

  function render() {
    const filtered = activeFilter === "all" ? articles : articles.filter(article =>
      article.category === activeFilter || article.region === activeFilter || (article.tags || []).includes(activeFilter));
    if (!filtered.length) {
      root.innerHTML = '<div class="vivid-editorial-empty"><span class="vivid-editorial-empty-mark">V</span><h3>Good stories deserve good sources.</h3><p>We’re preparing this newsroom’s approved publisher feeds. The existing Vivid release and discovery feed is still available below.</p><span class="vivid-editorial-empty-note">No unverified headlines or invented timestamps.</span></div>';
      return;
    }
    root.innerHTML = '<div class="vivid-editorial-grid">' + filtered.slice(0, 18).map((item, index) => card(item, index === 0)).join("") + '</div>';
  }

  filters.forEach(button => button.addEventListener("click", () => {
    filters.forEach(item => {
      item.classList.toggle("is-active", item === button);
      item.setAttribute("aria-pressed", item === button ? "true" : "false");
    });
    activeFilter = button.dataset.editorialFilter || "all";
    render();
  }));

  try {
    const feedQuery = query(collection(db, "articles"), where("status", "==", "published"), orderBy("publishedAt", "desc"), limit(60));
    unsubscribe = onSnapshot(feedQuery, snapshot => {
      articles = snapshot.docs.map(item => ({id:item.id, ...item.data()}));
      render();
      const status = document.getElementById("vivid-editorial-status");
      if (status) status.textContent = articles.length ? articles.length + " sourced stories" : "Newsroom setup in progress";
    }, error => {
      console.warn("Vivid editorial feed unavailable:", error);
      root.innerHTML = '<div class="vivid-editorial-empty"><h3>The newsroom is temporarily unavailable.</h3><p>Your release calendar and cinema discovery feed remain available below.</p></div>';
    });
  } catch (error) {
    console.warn("Vivid editorial feed could not start:", error);
  }

  window.addEventListener("pagehide", () => unsubscribe?.(), {once:true});
}
