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
    film: "Film", television: "TV", celebrity: "People", streaming: "Streaming", music: "Music", gaming: "Gaming", anime: "Anime", animation: "Animation", "box-office": "Box office", festivals: "Festivals", production: "Production", business: "Business", legal: "Legal", comics: "Comics", theatre: "Theatre", podcasts: "Podcasts", creators: "Creators",
    awards: "Awards", ghana: "Ghana", nollywood: "Nollywood", africa: "Africa",
    asia: "Asia", india: "India", hollywood: "Hollywood", global: "Global",
    europe: "Europe", "latin-america": "Latin America", "middle-east": "Middle East",
    trailers: "Trailers", industry: "Industry"
  }[value] || "Entertainment");

  const regionAliases = {
    hollywood: ["hollywood", "us", "usa", "united-states", "north-america"],
    india: ["india", "south-asia"],
    africa: ["africa","west-africa","east-africa","north-africa","southern-africa","central-africa","ghana","nigeria","nollywood","kenya","south-africa","egypt","morocco","senegal","ivory-coast","cote-d-ivoire","ethiopia","tanzania","uganda","rwanda","cameroon","algeria","tunisia","angola","zimbabwe","zambia","mozambique","namibia","botswana","democratic-republic-of-the-congo","dr-congo","republic-of-the-congo","congo","gabon","equatorial-guinea","sao-tome-and-principe","central-african-republic","chad","niger","mali","burkina-faso","benin","togo","liberia","sierra-leone","guinea","guinea-bissau","gambia","mauritania","cabo-verde","cape-verde","sudan","south-sudan","eritrea","djibouti","somalia","burundi","malawi","lesotho","eswatini","swaziland","madagascar","mauritius","seychelles","comoros","libya","western-sahara"],
    asia: ["asia","east-asia","southeast-asia","south-east-asia","south-asia","asia-pacific","india","pakistan","bangladesh","sri-lanka","nepal","bhutan","maldives","afghanistan","kazakhstan","kyrgyzstan","tajikistan","turkmenistan","uzbekistan","south-korea","north-korea","korea","japan","china","hong-kong","taiwan","mongolia","thailand","indonesia","philippines","vietnam","malaysia","singapore","cambodia","laos","myanmar","brunei","timor-leste","australia","new-zealand","papua-new-guinea","fiji"],
    europe: ["europe", "uk", "united-kingdom", "france", "germany", "italy", "spain", "sweden", "poland"],
    "latin-america": ["latin-america", "south-america", "central-america", "mexico", "brazil", "argentina", "colombia", "chile"],
    "middle-east": ["middle-east", "mena", "saudi-arabia", "united-arab-emirates", "uae", "israel", "turkey", "lebanon", "qatar"]
  };

  function matchesFilter(article, filter) {
    if (filter === "all") return true;
    const values = [article.region, article.country, article.countryCode, article.category, ...(Array.isArray(article.tags) ? article.tags : [])]
      .filter(Boolean).map(value => String(value).toLowerCase().trim().replace(/[_ ]+/g, "-"));
    if (values.includes(filter)) return true;
    return (regionAliases[filter] || []).some(alias => values.includes(alias) || values.some(value => value.startsWith(alias + "-")));
  }

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
    const filtered = articles.filter(article => matchesFilter(article, activeFilter));
    if (!filtered.length) {
      root.setAttribute("aria-busy", "false");
      root.innerHTML = '<div class="vivid-editorial-empty"><span class="vivid-editorial-empty-mark">V</span><h3>Good stories deserve good sources.</h3><p>The newsroom is being curated. We publish source-attributed stories only after editorial review. The release radar and discovery feed remain available below.</p><span class="vivid-editorial-empty-note">No unverified headlines or invented timestamps.</span></div>';
      return;
    }
    const lead = filtered.find(item => item.featured === true);
    const cards = lead
      ? [card(lead, true), ...filtered.filter(item => item.id !== lead.id).slice(0, 17).map(item => card(item, false))]
      : filtered.slice(0, 18).map(item => card(item, false));
    root.innerHTML = '<div class="vivid-editorial-grid">' + cards.join("") + '</div>';
    root.setAttribute("aria-busy", "false");
  }

  function activateFilter(button) {
    activeFilter = button.dataset.editorialFilter || "all";
    filters.forEach(item => {
      const active = item.dataset.editorialFilter === activeFilter;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", active ? "true" : "false");
    });
    render();
  }
  filters.forEach(button => button.addEventListener("click", () => activateFilter(button)));

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
      root.setAttribute("aria-busy", "false");
      const status = document.getElementById("vivid-editorial-status");
      if (status) status.textContent = "Newsroom temporarily unavailable";
    });
  } catch (error) {
    console.warn("Vivid editorial feed could not start:", error);
    root.setAttribute("aria-busy", "false");
    root.innerHTML = '<div class="vivid-editorial-empty"><h3>The newsroom could not start.</h3><p>Your release calendar and cinema discovery feed remain available below.</p></div>';
    const status = document.getElementById("vivid-editorial-status");
    if (status) status.textContent = "Newsroom temporarily unavailable";
  }

  window.addEventListener("pagehide", () => unsubscribe?.(), {once:true});
}
