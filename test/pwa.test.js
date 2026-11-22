const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const pwaScriptPath = path.join(__dirname, "..", "pwa.js");

async function createPwaHarness({ userAgent = "Android", standalone = false } = {}) {
  const source = await fs.readFile(pwaScriptPath, "utf8");
  const windowListeners = new Map();
  const buttonListeners = new Map();
  const statusClasses = new Set();
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
  const window = {
    isSecureContext: true,
    matchMedia: () => ({ matches: standalone }),
    addEventListener: (name, listener) => windowListeners.set(name, listener)
  };
  const navigator = {
    platform: "Linux",
    serviceWorker: { register: () => Promise.resolve() },
    userAgent
  };
  const document = {
    querySelector(selector) {
      return selector === "[data-install-app]" ? installButton : status;
    }
  };

  vm.runInNewContext(source, { document, navigator, window, console });
  return { buttonListeners, installButton, status, statusClasses, windowListeners };
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
