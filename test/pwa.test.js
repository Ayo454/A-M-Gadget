const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const projectDirectory = path.join(__dirname, "..");
const pwaScriptPath = path.join(__dirname, "..", "pwa.js");

function createFakeClock() {
  let now = 0;
  let nextTimerId = 0;
  const timers = new Map();
  const ClockDate = class extends Date {
    static now() {
      return now;
    }
  };
  return {
    Date: ClockDate,
    setTimeout(callback, delay = 0) {
      const id = ++nextTimerId;
      timers.set(id, { callback, dueAt: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        let nextTimer = null;
        for (const [id, timer] of timers) {
          if (timer.dueAt <= target && (!nextTimer || timer.dueAt < nextTimer.timer.dueAt)) {
            nextTimer = { id, timer };
          }
        }
        if (!nextTimer) break;
        timers.delete(nextTimer.id);
        now = nextTimer.timer.dueAt;
        nextTimer.timer.callback();
      }
      now = target;
    }
  };
}

async function createPwaHarness({
  userAgent = "Android",
  standalone = false,
  withLoader = false,
  readyState = "complete",
  fakeTimers = false
} = {}) {
  const source = await fs.readFile(pwaScriptPath, "utf8");
  const clock = fakeTimers ? createFakeClock() : null;
  const windowListeners = new Map();
  const buttonListeners = new Map();
  const statusClasses = new Set();
  const loaderClasses = new Set();
  const installButton = {
    hidden: true,
    addEventListener: (name, listener) => buttonListeners.set(name, listener)
  };
  const status = {
    textContent: "",
    classList: {
      toggle(name, enabled) {
        if (enabled) statusClasses.add(name);
        else statusClasses.delete(name);
      }
    }
  };
  const launchScreen = withLoader ? {
    hidden: false,
    classList: {
      add(name) {
        loaderClasses.add(name);
      }
    },
    addEventListener() {}
  } : null;
  const window = {
    isSecureContext: true,
    matchMedia: () => ({ matches: standalone }),
    addEventListener: (name, listener) => windowListeners.set(name, listener),
    setTimeout: clock ? clock.setTimeout.bind(clock) : setTimeout,
    clearTimeout: clock ? clock.clearTimeout.bind(clock) : clearTimeout
  };
  const navigator = {
    platform: "Linux",
    serviceWorker: { register: () => Promise.resolve() },
    userAgent
  };
  const document = {
    readyState,
    querySelector(selector) {
      if (selector === "[data-install-app]") return installButton;
      if (selector === "[data-pwa-status]") return status;
      if (selector === "[data-app-loader]") return launchScreen;
      return null;
    }
  };

  vm.runInNewContext(source, { Date: clock ? clock.Date : Date, document, navigator, window, console });
  return {
    advanceTime: clock ? clock.advance.bind(clock) : null,
    buttonListeners,
    installButton,
    launchScreen,
    loaderClasses,
    status,
    statusClasses,
    windowListeners
  };
}

function installPrompt(outcome) {
  let promptCount = 0;
  return {
    event: {
      preventDefault() {},
      prompt() {
        promptCount += 1;
      },
      userChoice: Promise.resolve({ outcome })
    },
    promptCount: () => promptCount
  };
}

test("the public site and each app have installable manifests and raster icons", async () => {
  const pages = [
    ["index.html", "site.webmanifest"],
    ["app.html", "app.webmanifest"],
    ["customer-care.app.html", "customer-care.webmanifest"],
    ["rider.app.html", "rider.webmanifest"],
    ["admin.html", "admin.webmanifest"]
  ];

  for (const [pageFile, manifestFile] of pages) {
    const page = await fs.readFile(path.join(projectDirectory, pageFile), "utf8");
    const manifestLink = manifestFile.replace(".", "\\.");
    assert.match(page, new RegExp(`<link rel="manifest" href="/${manifestLink}">`), pageFile);
    assert.match(page, /data-install-app/, pageFile);
    if (pageFile === "index.html") assert.match(page, /src="\/pwa\.js"/);

    const manifest = JSON.parse(await fs.readFile(path.join(projectDirectory, manifestFile), "utf8"));
    for (const icon of manifest.icons.filter(item => item.type === "image/png")) {
      const iconPath = path.join(projectDirectory, icon.src.slice(1));
      const png = await fs.readFile(iconPath);
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], icon.src);
      assert.equal(png.readUInt32BE(16), Number(icon.sizes.split("x")[0]), icon.src);
      assert.equal(png.readUInt32BE(20), Number(icon.sizes.split("x")[1]), icon.src);
    }
  }

  const netlifyConfig = await fs.readFile(path.join(projectDirectory, "netlify.toml"), "utf8");
  assert.match(netlifyConfig, /for = "\/\*\.webmanifest"/);
  assert.match(netlifyConfig, /Content-Type = "application\/manifest\+json"/);
});

test("opens the native install prompt and keeps the button after dismissal", async () => {
  const dismissed = await createPwaHarness();
  const canceledPrompt = installPrompt("dismissed");
  dismissed.windowListeners.get("beforeinstallprompt")(canceledPrompt.event);
  assert.equal(dismissed.installButton.hidden, false);
  await dismissed.buttonListeners.get("click")();
  assert.equal(canceledPrompt.promptCount(), 1);
  assert.equal(dismissed.installButton.hidden, false);
  assert.match(dismissed.status.textContent, /Installation was canceled/);

  const accepted = await createPwaHarness();
  const acceptedPrompt = installPrompt("accepted");
  accepted.windowListeners.get("beforeinstallprompt")(acceptedPrompt.event);
  await accepted.buttonListeners.get("click")();
  assert.equal(accepted.installButton.hidden, true);
  assert.match(accepted.status.textContent, /installation started/i);
});

test("shows iPhone installation steps and hides the button when already installed", async () => {
  const iphone = await createPwaHarness({ userAgent: "iPhone" });
  await iphone.buttonListeners.get("click")();
  assert.match(iphone.status.textContent, /Safari.*Share.*Add to Home Screen/);
  assert.equal(iphone.statusClasses.has("install-help"), true);

  const installed = await createPwaHarness({ standalone: true });
  assert.equal(installed.installButton.hidden, true);
  assert.match(installed.status.textContent, /App is installed/);
});

test("keeps the launch screen until page load and fades it away", async () => {
  const app = await createPwaHarness({ withLoader: true, readyState: "loading", fakeTimers: true });
  assert.equal(app.launchScreen.hidden, false);
  app.windowListeners.get("load")();
  app.advanceTime(9999);
  assert.equal(app.loaderClasses.has("is-hidden"), false);
  app.advanceTime(1);
  assert.equal(app.loaderClasses.has("is-hidden"), true);
  assert.equal(app.launchScreen.hidden, false);
  app.advanceTime(350);
  assert.equal(app.launchScreen.hidden, true);
});
