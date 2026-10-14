/* Vivid Cinema social invite: waits for full load + 30 seconds; dismissals persist. */
(()=> {
  const init = () => {
    if (document.getElementById("vivid-social-invite")) return;
    const storageKey = "vivid-social-invite-dismissed";
    let dismissed = false;
    try { dismissed = localStorage.getItem(storageKey) === "1"; } catch (_) {}
    if (dismissed) return;
    const card = document.createElement("aside");
    card.id = "vivid-social-invite";
    card.className = "vivid-social-invite";
    card.hidden = true;
    card.setAttribute("aria-labelledby", "vivid-social-invite-title");
    card.setAttribute("aria-describedby", "vivid-social-invite-description");
    card.innerHTML = `
      <div class="vivid-social-invite-head">
        <div class="vivid-social-invite-mark" aria-hidden="true"><i class="bi bi-people-fill"></i></div>
        <div class="vivid-social-invite-copy">
          <h2 id="vivid-social-invite-title">Join our socials</h2>
          <p id="vivid-social-invite-description">Stay close to Vivid Cinema — news, updates and community.</p>
        </div>
        <button class="vivid-social-invite-close" type="button" aria-label="Close social links">&times;</button>
      </div>
      <nav class="vivid-social-invite-links" aria-label="Vivid Cinema social links">
        <a href="https://discord.gg/eQGejwGcn" target="_blank" rel="noopener noreferrer"><i class="bi bi-discord" aria-hidden="true"></i> Discord</a>
        <a href="https://instagram.com/vivid_cinemaofficial?obrf=MTZqZmc2dnlqcnJvNA%3D%3D&utm_source=qr" target="_blank" rel="noopener noreferrer"><i class="bi bi-instagram" aria-hidden="true"></i> Instagram</a>
        <a href="https://www.reddit.com/u/AdUnable5314/s/rhalyPvPhn" target="_blank" rel="noopener noreferrer"><i class="bi bi-reddit" aria-hidden="true"></i> Reddit</a>
      </nav>
      <small class="vivid-social-invite-note">You can close this anytime.</small>`;
    document.body.appendChild(card);
    const close = () => {
      card.classList.remove("is-visible");
      window.setTimeout(() => { card.hidden = true; }, 300);
      try { localStorage.setItem(storageKey, "1"); } catch (_) {}
    };
    card.querySelector(".vivid-social-invite-close").addEventListener("click", close);
    window.setTimeout(() => {
      if (!card.isConnected || dismissed) return;
      card.hidden = false;
      requestAnimationFrame(() => card.classList.add("is-visible"));
    }, 30000);
  };
  if (document.readyState === "complete") init();
  else window.addEventListener("load", init, { once: true });
})();