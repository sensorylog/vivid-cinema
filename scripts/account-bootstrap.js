(() => {
  const status = document.getElementById("account-status");
  let diagnosed = false;
  const showDiagnostic = (message) => {
    if (!status || diagnosed) return;
    diagnosed = true;
    status.textContent = message;
    status.dataset.state = "error";
  };

  window.addEventListener("error", (event) => {
    const target = event.target;
    const source = target?.src || event.filename || "";
    if (/account\.js|firebase\.js|app-shell\.js|account-bootstrap\.js/.test(source)) {
      console.error("Vivid account bootstrap asset failed:", source, event.message || "");
      showDiagnostic("Account scripts could not start. Open Vivid in Safari and reload. If it still fails, send support code ACCOUNT_SCRIPT_LOAD_FAILED.");
    }
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    const message = String(event.reason?.message || event.reason || "");
    if (/Firebase configuration|Firebase App|auth\/|firestore|module script/i.test(message)) {
      console.error("Vivid account bootstrap rejected:", event.reason);
      showDiagnostic("Account startup failed while connecting to Firebase. Check your connection and reload. Support code ACCOUNT_FIREBASE_BOOT_FAILED.");
    }
  });

  window.setTimeout(() => {
    if (status && /checking your session|loading…/i.test(status.textContent || "")) {
      showDiagnostic("Account startup did not finish. This may be a stale installed-app cache or a Firebase connection/configuration error. Open Vivid in Safari and reload. Support code ACCOUNT_BOOT_TIMEOUT.");
    }
  }, 9000);
})();
