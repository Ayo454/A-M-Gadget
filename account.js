const accountStatus = document.querySelector("#accountStatus");
const loginForm = document.querySelector("#loginForm");
const registerForm = document.querySelector("#registerForm");

async function accountRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result;
}

function showAccountStatus(message, isError = false) {
  accountStatus.textContent = message;
  accountStatus.classList.toggle("error", isError);
}

function setFormMode(mode) {
  const isRegister = mode === "register";
  loginForm.hidden = isRegister;
  registerForm.hidden = !isRegister;
  document.querySelector("#showLogin").classList.toggle("active", !isRegister);
  document.querySelector("#showRegister").classList.toggle("active", isRegister);
  document.querySelector("#showLogin").setAttribute("aria-selected", String(!isRegister));
  document.querySelector("#showRegister").setAttribute("aria-selected", String(isRegister));
  showAccountStatus("");
}

document.querySelector("#showLogin").addEventListener("click", () => setFormMode("login"));
document.querySelector("#showRegister").addEventListener("click", () => setFormMode("register"));

const profileImage = document.querySelector("#profileImage");
const avatarPreview = document.querySelector("#avatarPreview");

profileImage.addEventListener("change", () => {
  const file = profileImage.files[0];
  if (!file) {
    avatarPreview.hidden = true;
    avatarPreview.removeAttribute("src");
    showAccountStatus("");
    return;
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    profileImage.value = "";
    avatarPreview.hidden = true;
    showAccountStatus("Choose a PNG, JPG, or WebP image.", true);
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    profileImage.value = "";
    avatarPreview.hidden = true;
    showAccountStatus("The profile photo must be 2 MB or smaller.", true);
    return;
  }
  avatarPreview.src = URL.createObjectURL(file);
  avatarPreview.hidden = false;
  showAccountStatus("");
});

function readAvatar(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result);
      resolve({ type: file.type, data: dataUrl.slice(dataUrl.indexOf(",") + 1) });
    });
    reader.addEventListener("error", () => reject(new Error("The profile photo could not be read.")));
    reader.readAsDataURL(file);
  });
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(loginForm));
  try {
    await accountRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(values)
    });
    window.location.assign("profile.html");
  } catch (error) {
    showAccountStatus(error.message, true);
  }
});

registerForm.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const values = Object.fromEntries(
      Array.from(new FormData(registerForm).entries()).filter(([name]) => name !== "avatar")
    );
    const image = profileImage.files[0];
    if (image) values.avatar = await readAvatar(image);
    await accountRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(values)
    });
    window.location.assign("profile.html");
    avatarPreview.hidden = true;
  } catch (error) {
    showAccountStatus(error.message, true);
  }
});

const menuButton = document.querySelector(".menu-button");
const nav = document.querySelector(".nav");
menuButton.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(open));
});

accountRequest("/api/auth/session")
  .then(result => {
    if (result.user && result.user.role === "customer") window.location.replace("profile.html");
    if (result.user && result.user.role === "admin") {
      showAccountStatus("The store admin is signed in in this browser. Sign out from the account icon before signing in as a customer.");
    }
    if (result.user && result.user.role === "rider") {
      showAccountStatus("A rider account is signed in in this browser. Continue to the rider portal or sign out before using a customer account.");
    }
  })
  .catch(error => showAccountStatus(error.message, true));
