(() => {
const accountButton = document.querySelector(".account-button");
const accountIcon = document.querySelector(".account-icon");
const accountAvatarIcon = document.querySelector(".account-avatar-icon");
const nav = document.querySelector(".nav");
const menuButton = document.querySelector(".menu-button");
const accountMenu = document.createElement("div");
accountMenu.className = "account-menu";
accountMenu.hidden = true;
accountButton.parentElement.append(accountMenu);

let currentUser = null;

function renderAccountMenu() {
  if (currentUser && currentUser.role === "admin") {
    accountMenu.innerHTML = `
      <p class="account-menu-message">The store admin is signed in on this browser.</p>
      <button class="account-logout" type="button">Sign out</button>
      <p class="account-menu-status" role="status" aria-live="polite"></p>
    `;
    return;
  }
  accountMenu.innerHTML = `
    <a href="profile.html">Profile</a>
    <a href="account-info.html">Account info</a>
    <a href="orders.html">Orders</a>
    <button class="account-logout" type="button">Sign out</button>
    <p class="account-menu-status" role="status" aria-live="polite"></p>
  `;
}

if (!document.querySelector("#productGrid") && !document.querySelector("#loginForm")) {
  menuButton.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
  });
  nav.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      nav.classList.remove("open");
      menuButton.setAttribute("aria-expanded", "false");
    });
  });
}

if (!document.querySelector("#productGrid") && !document.querySelector("#loginForm")) {
  document.querySelector(".announcement button").addEventListener("click", event => {
    event.currentTarget.parentElement.remove();
    document.querySelector(".header").style.top = "0";
    nav.style.top = "82px";
  });
}

function setAccountMenu(open) {
  accountMenu.hidden = !open;
  accountButton.setAttribute("aria-expanded", String(open));
}

accountButton.addEventListener("click", () => {
  if (!currentUser) {
    if (!window.location.pathname.endsWith("/account.html")) window.location.assign("account.html");
    return;
  }
  setAccountMenu(accountMenu.hidden);
});

accountMenu.addEventListener("click", async event => {
  if (!event.target.closest(".account-logout")) return;
  const status = accountMenu.querySelector(".account-menu-status");
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not sign out.");
    currentUser = null;
    setAccountMenu(false);
    window.location.assign("index.html");
  } catch (error) {
    status.textContent = error.message;
  }
});

document.addEventListener("click", event => {
  if (!accountMenu.hidden && !accountMenu.contains(event.target) && !accountButton.contains(event.target)) {
    setAccountMenu(false);
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") setAccountMenu(false);
});

fetch("/api/auth/session")
  .then(async response => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Account status could not be loaded.");
    return result;
  })
  .then(result => {
    currentUser = result.user;
    renderAccountMenu();
    if (currentUser && currentUser.role === "customer" && currentUser.avatarUrl) {
      accountIcon.hidden = true;
      accountAvatarIcon.src = currentUser.avatarUrl;
      accountAvatarIcon.hidden = false;
      accountButton.setAttribute("aria-label", "Open your account menu");
    } else if (currentUser) {
      accountButton.setAttribute("aria-label", "Open your account menu");
    }
  })
  .catch(error => console.error("Could not load account status:", error));
})();
