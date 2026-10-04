const authLink = document.getElementById("auth-link");
const pageAuthLinks = document.querySelectorAll("#library-auth, #title-auth");
const userDropdown = document.getElementById("user-dropdown");
const userEmail = document.getElementById("user-email");
const logoutLink = document.getElementById("logout-link");

async function initAuthUi() {
  try {
    const [{ auth }, { onAuthStateChanged, signOut }] = await Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js")
    ]);

    onAuthStateChanged(auth, (user) => {
      window.dispatchEvent(new CustomEvent("vivid:auth-ready", { detail: user }));
      if (user) {
        pageAuthLinks.forEach(link => {
          link.style.display = "";
          link.textContent = "Account";
          link.href = "account.html";
          link.setAttribute("aria-label", "Open account");
        });
        if (authLink) {
          authLink.style.display = "";
          authLink.innerHTML = '<i class="bi bi-person-fill" aria-hidden="true"></i>';
          authLink.href = "account.html";
          authLink.setAttribute("aria-label", "Open account");
        }
        if (userDropdown) userDropdown.style.display = "";
        if (userEmail) userEmail.textContent = user.email || user.displayName || "Account";
      } else {
        pageAuthLinks.forEach(link => {
          link.style.display = "";
          link.textContent = "Sign in";
          link.href = "auth.html";
          link.setAttribute("aria-label", "Sign in");
        });
        if (authLink) {
          authLink.style.display = "";
          authLink.innerHTML = '<i class="bi bi-person-fill" aria-hidden="true"></i>';
          authLink.href = "auth.html";
          authLink.setAttribute("aria-label", "Sign in");
        }
        if (userDropdown) userDropdown.style.display = "none";
      }
    });

    logoutLink?.addEventListener("click", async (event) => {
      event.preventDefault();
      await signOut(auth);
      window.location.href = "login.html";
    });
  } catch (error) {
    console.warn("Vivid auth UI unavailable:", error);
  }
}

function scheduleAuthUi() {
  if ("requestIdleCallback" in window) requestIdleCallback(initAuthUi, { timeout: 1500 });
  else window.setTimeout(initAuthUi, 250);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scheduleAuthUi, { once: true });
} else {
  scheduleAuthUi();
}
