const installAppButton = document.querySelector("[data-install-app]");
const pwaStatus = document.querySelector("[data-pwa-status]");
const appLaunchScreen = document.querySelector("[data-app-loader]");
let deferredInstallPrompt = null;

function setPwaStatus(message, showInstallHelp = false) {
  if (!pwaStatus) return;
  pwaStatus.textContent = message;
  pwaStatus.classList.toggle("install-help", showInstallHelp);
}

if (appLaunchScreen) {
  const minimumVisibleMs = 20000;
  const startedAt = Date.now();
  let hideScheduled = false;
  let loadFallback;

  function hideAppLaunchScreen() {
    if (hideScheduled) return;
    hideScheduled = true;
    window.clearTimeout(loadFallback);
    const remainingMs = Math.max(0, minimumVisibleMs - (Date.now() - startedAt));
    window.setTimeout(() => {
      appLaunchScreen.classList.add("is-hidden");
      const finishHiding = () => {
        appLaunchScreen.hidden = true;
      };
      appLaunchScreen.addEventListener("transitionend", finishHiding, { once: true });
      window.setTimeout(finishHiding, 350);
    }, remainingMs);
  }

  loadFallback = window.setTimeout(hideAppLaunchScreen, 30000);
  if (document.readyState === "complete") hideAppLaunchScreen();
  else window.addEventListener("load", hideAppLaunchScreen, { once: true });
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/service-worker.js").catch(error => {
    console.error("Could not register the app service worker:", error);
    setPwaStatus("Offline app support could not be enabled. Check your connection and reload.");
  });
}

if (installAppButton) {
  const isStandalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    navigator.standalone === true;
  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  installAppButton.hidden = isStandalone;
  if (isStandalone) setPwaStatus("App is installed.");

  window.addEventListener("beforeinstallprompt", event => {
    if (isStandalone) return;
    event.preventDefault();
    deferredInstallPrompt = event;
    setPwaStatus("Install is ready. Click Install app to continue.");
  });

  installAppButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      setPwaStatus(
        isAppleMobile
          ? "On iPhone or iPad, open this page in Safari, tap Share, then tap Add to Home Screen."
          : "Open your browser menu and choose Install app or Add to Home Screen.",
        true
      );
      return;
    }
    const installPrompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        installAppButton.hidden = true;
        setPwaStatus("App installation started.");
      } else {
        setPwaStatus("Installation was canceled. You can try again from your browser menu.");
      }
    } catch (error) {
      console.error("Could not open the app install prompt:", error);
      setPwaStatus("Your browser could not open installation. Use its menu to install the app.");
    }
  });

  window.addEventListener("appinstalled", () => {
    installAppButton.hidden = true;
    deferredInstallPrompt = null;
    setPwaStatus("App installed successfully.");
  });
}
