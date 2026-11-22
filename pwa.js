const installAppButton = document.querySelector("[data-install-app]");
const pwaStatus = document.querySelector("[data-pwa-status]");
let deferredInstallPrompt = null;

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/service-worker.js").catch(error => {
    console.error("Could not register the app service worker:", error);
    if (pwaStatus) pwaStatus.textContent = "Offline app support could not be enabled. Check your connection and reload.";
  });
}

if (installAppButton) {
  installAppButton.hidden = false;
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  installAppButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      if (pwaStatus) {
        pwaStatus.textContent = /iPhone|iPad|iPod/i.test(navigator.userAgent)
          ? "To install, tap Share in Safari, then choose Add to Home Screen."
          : "To install, open your browser menu and choose Install app or Add to Home Screen.";
      }
      return;
    }
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installAppButton.hidden = true;
    if (pwaStatus) {
      pwaStatus.textContent = choice.outcome === "accepted"
        ? "App installation started."
        : "You can install the app later from your browser menu.";
    }
  });

  window.addEventListener("appinstalled", () => {
    installAppButton.hidden = true;
    deferredInstallPrompt = null;
    if (pwaStatus) pwaStatus.textContent = "App installed successfully.";
  });
}
