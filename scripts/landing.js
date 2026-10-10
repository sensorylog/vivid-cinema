import { getFeaturedMovies } from "./content.js";
import { getImageUrl } from "./media.js";
import { auth, db } from "./firebase.js";
import { GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const message = $("landing-message");

function setMessage(text, good = false) {
  if (!message) return;
  message.textContent = text;
  message.style.color = good ? "#9be7ad" : "#ff9c9c";
}

function rememberEmail(email) {
  try {
    sessionStorage.setItem("vivid:signup-email", email);
  } catch {}
  window.location.href = "auth.html";
}

function wireForms() {
  document.querySelectorAll("[data-landing-email-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const email = input?.value.trim() || "";
      if (!email || !input?.checkValidity()) {
        setMessage("Enter a valid email address.");
        input?.focus();
        return;
      }
      rememberEmail(email);
    });
  });

  document.querySelectorAll("[data-google-start]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      setMessage("Connecting to Google…", true);
      try {
        const credential = await signInWithPopup(auth, new GoogleAuthProvider());
        await setDoc(doc(db, "users", credential.user.uid), {
          displayName: credential.user.displayName || "",
          email: credential.user.email || null,
          provider: credential.user.providerData?.[0]?.providerId || "google.com",
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp()
        }, { merge: true });
        window.location.href = "home.html";
      } catch (error) {
        console.error(error);
        setMessage(
          error?.code === "auth/popup-blocked"
            ? "Your browser blocked the Google window. Allow popups and try again."
            : error?.code === "auth/popup-closed-by-user"
              ? "Google sign-in was cancelled."
              : "Google sign-in could not be completed. Try email instead."
        );
        button.disabled = false;
      }
    });
  });
}

function createPoster(item, index) {
  const title = item.title || item.name || "Untitled";
  const mediaType = item.media_type === "tv" ? "tv" : "movie";
  const link = document.createElement("a");
  link.className = "landing-poster";
  link.href = `title.html?id=${encodeURIComponent(item.id)}&type=${encodeURIComponent(mediaType)}`;
  link.setAttribute("aria-label", `View details for ${title}`);

  const image = document.createElement("img");
  image.src = getImageUrl(item.poster_path || item.backdrop_path, "w342");
  image.alt = title;
  image.loading = "lazy";
  image.decoding = "async";

  const rank = document.createElement("span");
  rank.className = "landing-rank";
  rank.setAttribute("aria-hidden", "true");
  rank.textContent = String(index + 1);

  const label = document.createElement("span");
  label.className = "landing-poster-title";
  label.textContent = title;

  link.append(image, rank, label);
  return link;
}

function showTrendingMessage(rail, text) {
  rail.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "landing-trending-status";
  empty.setAttribute("role", "status");
  empty.textContent = text;
  rail.append(empty);
}

function setHeroBackdrops(items) {
  const layer = $("landing-backdrops");
  if (!layer) return;

  layer.replaceChildren();
  const backdrops = items.filter((item) => item.backdrop_path).slice(0, 4);
  backdrops.forEach((item, index) => {
    const backdrop = document.createElement("div");
    backdrop.className = "landing-backdrop";
    backdrop.style.backgroundImage = `url("${getImageUrl(item.backdrop_path, "w1280")}")`;
    backdrop.setAttribute("aria-hidden", "true");
    if (index === 0) backdrop.classList.add("is-visible");
    layer.append(backdrop);
  });

  if (backdrops.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let current = 0;
  window.setInterval(() => {
    if (document.hidden) return;
    const layers = layer.querySelectorAll(".landing-backdrop");
    layers[current]?.classList.remove("is-visible");
    current = (current + 1) % layers.length;
    layers[current]?.classList.add("is-visible");
  }, 7000);
}

async function loadTrending() {
  const rail = $("landing-trending");
  if (!rail) return;

  try {
    const items = (await getFeaturedMovies(6)).filter((item) => item.poster_path || item.backdrop_path);
    if (!items.length) {
      showTrendingMessage(rail, "Trending titles are unavailable right now. You can still browse the full catalogue.");
      setHeroBackdrops([]);
      return;
    }

    rail.replaceChildren(...items.map(createPoster));
    setHeroBackdrops(items);
  } catch (error) {
    console.warn("Landing discovery unavailable:", error);
    showTrendingMessage(rail, "We couldn't load trending titles. Please browse the full catalogue instead.");
  }
}

function wireFaq() {
  document.querySelectorAll(".landing-faq-q").forEach((button) => {
    button.addEventListener("click", () => {
      const item = button.closest(".landing-faq-item");
      if (!item) return;
      const open = item.classList.toggle("is-open");
      button.setAttribute("aria-expanded", String(open));
    });
  });
}

wireForms();
wireFaq();
void loadTrending();
