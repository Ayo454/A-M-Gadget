const appAuth = document.querySelector("#appAuth");
const appShell = document.querySelector("#appShell");
const appFeedback = document.querySelector("#appFeedback");
const appProductGrid = document.querySelector("#appProductGrid");
const appCartOverlay = document.querySelector("#cartOverlay");
const appCheckoutOverlay = document.querySelector("#checkoutOverlay");
const appCheckoutForm = document.querySelector("#appCheckoutForm");
const appPaymentConfirmation = document.querySelector("#appPaymentConfirmation");
const appLoginForm = document.querySelector("#appLoginForm");
const appRegisterForm = document.querySelector("#appRegisterForm");
const appCartStorageKey = "a-m-gadget-app-cart";
const appProductsPerPage = 8;
let appUser = null;
let appProducts = [];
let appProductsLoaded = false;
let appCart = [];
let selectedCategory = "All";
let appCurrentPage = 1;
let activeAppView = "shop";
let appViewBeforeCart = "shop";
let checkoutReturnView = "shop";
let quoteVersion = 0;
let activeQuoteKey = "";
let paymentOrderId = "";
let quoteTimer = null;
let supportPollTimer = null;
let supportCallPeer = null;
let supportLocalAudio = null;
let supportCallId = "";
let supportPollPending = false;
let supportLastHeartbeatAt = 0;
let supportSeenSignals = new Set();
let supportPendingCandidates = [];

async function appRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The app could not read the server response. Try again.");
  }
  if (!response.ok) {
    const error = new Error(result.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function setAppFeedback(message, isError = false) {
  appFeedback.textContent = message;
  appFeedback.classList.toggle("error", isError);
}

function setAuthFeedback(message, isError = false) {
  const feedback = document.querySelector("#appAuthFeedback");
  feedback.textContent = message;
  feedback.classList.toggle("error", isError);
}

function setCheckoutFeedback(message, isError = false) {
  const feedback = document.querySelector("#checkoutFeedback");
  feedback.textContent = message;
  feedback.classList.toggle("error", isError);
}

function formatAppMoney(value) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function showAppView(view) {
  if (!appCheckoutOverlay.hidden) closeCheckout();
  if (view === "bag") {
    openCart();
    return;
  }
  if (!appCartOverlay.hidden) closeCart();
  activeAppView = view;
  document.querySelectorAll("[data-app-panel]").forEach(panel => {
    panel.hidden = panel.dataset.appPanel !== view;
  });
  document.querySelectorAll("[data-app-view]").forEach(button => {
    const active = button.dataset.appView === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  if (view === "orders") loadAppOrders().catch(error => setAppFeedback(error.message, true));
  if (view === "support") {
    if (!appUser) {
      setSupportFeedback("Sign in or create an account to chat or call customer care.");
      openAuth("login");
      return;
    }
    loadCustomerSupport().catch(error => setSupportFeedback(error.message, true));
    window.clearInterval(supportPollTimer);
    supportPollTimer = window.setInterval(() => {
      loadCustomerSupport().catch(error => setSupportFeedback(error.message, true));
    }, 2500);
  } else {
    window.clearInterval(supportPollTimer);
    supportPollTimer = appUser && supportCallId
      ? window.setInterval(() => {
        loadCustomerSupport().catch(error => setSupportFeedback(error.message, true));
      }, 2500)
      : null;
  }
}

function setAuthMode(mode) {
  const registering = mode === "register";
  appLoginForm.hidden = registering;
  appRegisterForm.hidden = !registering;
  document.querySelector("#appShowLogin").classList.toggle("active", !registering);
  document.querySelector("#appShowRegister").classList.toggle("active", registering);
  document.querySelector("#appShowLogin").setAttribute("aria-selected", String(!registering));
  document.querySelector("#appShowRegister").setAttribute("aria-selected", String(registering));
  setAuthFeedback("");
}

function openAuth(mode = "login") {
  setAuthMode(mode);
  appAuth.hidden = false;
  const field = appAuth.querySelector('input[type="email"]');
  if (field) field.focus();
}

function loadSavedCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(appCartStorageKey) || "[]");
    appCart = Array.isArray(saved)
      ? saved.filter(item => item && typeof item.id === "string" && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0)
        .map(item => ({ id: item.id, quantity: Math.min(99, Number(item.quantity)) }))
      : [];
  } catch (error) {
    console.error("Could not restore the app shopping bag:", error);
    appCart = [];
  }
}

function saveCart() {
  localStorage.setItem(appCartStorageKey, JSON.stringify(appCart));
}

function getCartProduct(item) {
  return appProducts.find(product => product.id === item.id);
}

function getCartSubtotal() {
  return appCart.reduce((sum, item) => {
    const product = getCartProduct(item);
    return sum + (product ? Number(product.price) * item.quantity : 0);
  }, 0);
}

function updateCartBadge() {
  const totalItems = appCart.reduce((sum, item) => sum + item.quantity, 0);
  const countLabel = totalItems > 99 ? "99+" : String(totalItems);
  document.querySelector("#appCartCount").textContent = countLabel;
  const mobileCount = document.querySelector("#appMobileCartCount");
  mobileCount.textContent = countLabel;
  mobileCount.hidden = totalItems === 0;
  document.querySelector("#appMobileBagButton").setAttribute(
    "aria-label",
    `Shopping bag, ${totalItems} ${totalItems === 1 ? "item" : "items"}`
  );
}

function renderCart() {
  const cartList = document.querySelector("#appCartList");
  cartList.replaceChildren();
  if (!appProductsLoaded) {
    const loading = document.createElement("p");
    loading.className = "app-empty";
    loading.textContent = appCart.length ? "Restoring your shopping bag..." : "Your shopping bag is empty.";
    cartList.append(loading);
    document.querySelector("#appCartSubtotal").textContent = formatAppMoney(0);
    updateCartBadge();
    return;
  }
  appCart = appCart.filter(item => getCartProduct(item));
  saveCart();
  if (!appCart.length) {
    const empty = document.createElement("p");
    empty.className = "app-empty";
    empty.textContent = "Your shopping bag is empty.";
    cartList.append(empty);
  }
  appCart.forEach(item => {
    const product = getCartProduct(item);
    if (!product) return;
    const row = document.createElement("article");
    const image = document.createElement("img");
    const details = document.createElement("div");
    const name = document.createElement("h3");
    const price = document.createElement("p");
    const controls = document.createElement("div");
    row.className = "app-cart-row";
    image.src = product.image || `/images/products/${product.type}.jpg`;
    image.alt = product.name;
    image.addEventListener("error", () => { image.src = `/images/products/${product.type}.jpg`; }, { once: true });
    name.textContent = product.name;
    price.textContent = formatAppMoney(Number(product.price) * item.quantity);
    details.append(name, price);
    controls.className = "app-quantity-control";
    [
      ["decrease", "−"],
      ["quantity", String(item.quantity)],
      ["increase", "+"]
    ].forEach(([action, label]) => {
      const element = action === "quantity" ? document.createElement("span") : document.createElement("button");
      if (action !== "quantity") {
        element.type = "button";
        element.dataset.cartAction = action;
        element.dataset.productId = product.id;
        element.setAttribute("aria-label", `${action === "increase" ? "Increase" : "Decrease"} ${product.name} quantity`);
      }
      element.textContent = label;
      controls.append(element);
    });
    row.append(image, details, controls);
    cartList.append(row);
  });
  document.querySelector("#appCartSubtotal").textContent = formatAppMoney(getCartSubtotal());
  updateCartBadge();
}

function addToCart(product) {
  const item = appCart.find(entry => entry.id === product.id);
  const nextQuantity = (item ? item.quantity : 0) + 1;
  if (Number.isInteger(Number(product.stock)) && nextQuantity > Number(product.stock)) {
    setAppFeedback(`Only ${product.stock} ${product.name} available.`, true);
    return;
  }
  if (item) item.quantity = nextQuantity;
  else appCart.push({ id: product.id, quantity: 1 });
  saveCart();
  renderCart();
  setAppFeedback(`${product.name} added to your bag.`);
}

function changeCartQuantity(productId, amount) {
  const item = appCart.find(entry => entry.id === productId);
  const product = appProducts.find(entry => entry.id === productId);
  if (!item || !product) return;
  const quantity = item.quantity + amount;
  if (quantity > Number(product.stock)) {
    setAppFeedback(`Only ${product.stock} ${product.name} available.`, true);
    return;
  }
  if (quantity < 1) appCart = appCart.filter(entry => entry.id !== productId);
  else item.quantity = quantity;
  saveCart();
  renderCart();
}

function renderCategories() {
  const categories = [...new Set(appProducts.map(product => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const container = document.querySelector("#appCategories");
  container.replaceChildren();
  const options = ["All", ...categories];
  options.forEach(category => {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    const label = document.createElement("strong");
    button.type = "button";
    button.className = `app-category-tile ${selectedCategory === category ? "active" : ""}`;
    button.dataset.category = category;
    icon.className = "app-category-icon";
    icon.textContent = category === "All" ? "✦"
      : /phone|mobile/i.test(category) ? "▯"
      : /laptop|computer/i.test(category) ? "▱"
      : /headphone|audio/i.test(category) ? "◖"
      : /wearable|watch/i.test(category) ? "◷"
      : "◇";
    label.textContent = category === "All" ? "All gadgets" : category;
    button.append(icon, label);
    button.addEventListener("click", () => {
      selectedCategory = category;
      appCurrentPage = 1;
      renderCategories();
      renderProducts();
    });
    container.append(button);
  });
}

function renderProducts() {
  const search = document.querySelector("#appSearch").value.trim().toLowerCase();
  const filtered = appProducts.filter(product => {
    const matchesCategory = !selectedCategory || selectedCategory === "All" || product.category === selectedCategory;
    const matchesSearch = !search ||
      `${product.name} ${product.category} ${product.description || ""}`.toLowerCase().includes(search);
    return matchesCategory && matchesSearch;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / appProductsPerPage));
  appCurrentPage = Math.min(appCurrentPage, pageCount);
  renderProductPagination(filtered.length, pageCount);
  appProductGrid.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "app-empty";
    empty.textContent = appProducts.length ? "No gadgets match this search." : "Products are not available right now.";
    appProductGrid.append(empty);
    return;
  }
  const firstProductIndex = (appCurrentPage - 1) * appProductsPerPage;
  filtered.slice(firstProductIndex, firstProductIndex + appProductsPerPage).forEach(product => {
    const card = document.createElement("article");
    const imageWrap = document.createElement("div");
    const image = document.createElement("img");
    const details = document.createElement("div");
    const category = document.createElement("span");
    const name = document.createElement("h2");
    const description = document.createElement("p");
    const bottom = document.createElement("div");
    const price = document.createElement("div");
    const currentPrice = document.createElement("strong");
    const add = document.createElement("button");
    card.className = "app-product-card";
    imageWrap.className = "app-product-image";
    image.src = product.image || `/images/products/${product.type}.jpg`;
    image.alt = product.name;
    image.loading = "lazy";
    image.addEventListener("error", () => { image.src = `/images/products/${product.type}.jpg`; }, { once: true });
    if (product.badge) {
      const badge = document.createElement("span");
      badge.className = "app-product-badge";
      badge.textContent = product.badge;
      imageWrap.append(badge);
    }
    imageWrap.append(image);
    details.className = "app-product-details";
    category.className = "app-product-category";
    category.textContent = product.category;
    name.textContent = product.name;
    description.className = "app-product-description";
    description.textContent = product.description || "";
    bottom.className = "app-product-bottom";
    price.className = "app-product-price";
    currentPrice.textContent = formatAppMoney(product.price);
    price.append(currentPrice);
    if (product.oldPrice) {
      const oldPrice = document.createElement("del");
      oldPrice.textContent = formatAppMoney(product.oldPrice);
      price.append(oldPrice);
    }
    add.type = "button";
    add.className = "app-add-button";
    add.textContent = "+";
    add.disabled = Number(product.stock) === 0;
    add.setAttribute("aria-label", `Add ${product.name} to shopping bag`);
    add.addEventListener("click", () => addToCart(product));
    bottom.append(price, add);
    details.append(category, name, description, bottom);
    card.append(imageWrap, details);
    appProductGrid.append(card);
  });
}

function renderProductPagination(productCount, pageCount) {
  const pagination = document.querySelector("#appPagination");
  pagination.replaceChildren();
  pagination.hidden = productCount === 0;
  if (!productCount) return;

  const summary = document.createElement("span");
  const controls = document.createElement("div");
  const firstProduct = (appCurrentPage - 1) * appProductsPerPage + 1;
  const lastProduct = Math.min(appCurrentPage * appProductsPerPage, productCount);
  summary.className = "app-pagination-summary";
  summary.setAttribute("aria-live", "polite");
  summary.textContent = `Showing ${firstProduct}–${lastProduct} of ${productCount} gadgets`;
  controls.className = "app-pagination-controls";

  const addPageButton = (page, label = String(page), current = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `app-page-button ${current ? "active" : ""}`;
    button.textContent = label;
    button.setAttribute("aria-label", label === "Previous" || label === "Next" ? label : `Page ${page}`);
    if (current) button.setAttribute("aria-current", "page");
    button.disabled = current || label === "Previous" && appCurrentPage === 1 ||
      label === "Next" && appCurrentPage === pageCount;
    button.addEventListener("click", () => {
      appCurrentPage = page;
      renderProducts();
      document.querySelector("#appTopPicks").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    controls.append(button);
  };
  const addEllipsis = () => {
    const ellipsis = document.createElement("span");
    ellipsis.className = "app-page-ellipsis";
    ellipsis.setAttribute("aria-hidden", "true");
    ellipsis.textContent = "…";
    controls.append(ellipsis);
  };

  addPageButton(Math.max(1, appCurrentPage - 1), "Previous");
  let visiblePages;
  if (pageCount <= 7) {
    visiblePages = Array.from({ length: pageCount }, (_, index) => index + 1);
  } else if (appCurrentPage <= 4) {
    visiblePages = [1, 2, 3, 4, 5, "ellipsis", pageCount];
  } else if (appCurrentPage >= pageCount - 3) {
    visiblePages = [1, "ellipsis", pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
  } else {
    visiblePages = [1, "ellipsis", appCurrentPage - 1, appCurrentPage, appCurrentPage + 1, "ellipsis", pageCount];
  }
  visiblePages.forEach(page => {
    if (page === "ellipsis") addEllipsis();
    else addPageButton(page, String(page), page === appCurrentPage);
  });
  addPageButton(Math.min(pageCount, appCurrentPage + 1), "Next");
  pagination.append(summary, controls);
}

async function loadProducts() {
  appProductGrid.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "app-empty";
  loading.textContent = "Loading gadgets...";
  appProductGrid.append(loading);
  appProducts = await appRequest("/api/products");
  appProductsLoaded = true;
  renderCategories();
  renderProducts();
  renderCart();
}

function refreshAccountPanel() {
  const guest = document.querySelector("#appAccountGuest");
  const account = document.querySelector("#appAccountCard");
  guest.hidden = Boolean(appUser);
  account.hidden = !appUser;
  document.querySelector("#appSignIn").hidden = Boolean(appUser);
  document.querySelector("#supportMessageForm").hidden = !appUser;
  document.querySelector("#startSupportCall").disabled = !appUser;
  if (!appUser) return;
  document.querySelector("#appGreeting").textContent = `Hello, ${appUser.name.split(/\s+/)[0]}`;
  document.querySelector("#appAccountName").textContent = appUser.name;
  document.querySelector("#appAccountEmail").textContent = appUser.email;
  document.querySelector("#appAccountPhone").textContent = appUser.phone || "Not provided";
  document.querySelector("#appAccountAddress").textContent = appUser.address || "Not provided";
}

async function setAppUser(user) {
  appUser = user;
  appAuth.hidden = true;
  appShell.hidden = false;
  refreshAccountPanel();
  await loadAppOrders();
  if (new URLSearchParams(window.location.search).get("view") === "support") showAppView("support");
}

function setSupportFeedback(message, isError = false) {
  const feedback = document.querySelector("#supportFeedback");
  feedback.textContent = message;
  feedback.classList.toggle("error", isError);
}

function renderSupportMessages(thread) {
  const list = document.querySelector("#supportMessages");
  list.replaceChildren();
  if (!thread.messages.length) {
    const empty = document.createElement("p");
    empty.className = "app-empty";
    empty.textContent = "Send a message to start a conversation with customer care.";
    list.append(empty);
    return;
  }
  thread.messages.forEach(message => {
    const bubble = document.createElement("article");
    const sender = document.createElement("strong");
    const text = document.createElement("p");
    const time = document.createElement("time");
    bubble.className = `app-support-message ${message.senderRole === "customer" ? "mine" : ""}`;
    sender.textContent = message.senderRole === "customer" ? "You" : "Customer care";
    text.textContent = message.text;
    time.dateTime = message.createdAt;
    time.textContent = new Date(message.createdAt).toLocaleString();
    bubble.append(sender, text, time);
    list.append(bubble);
  });
  list.scrollTop = list.scrollHeight;
}

function closeCustomerCall() {
  if (supportCallPeer) {
    supportCallPeer.onicecandidate = null;
    supportCallPeer.ontrack = null;
    supportCallPeer.close();
    supportCallPeer = null;
  }
  if (supportLocalAudio) {
    supportLocalAudio.getTracks().forEach(track => track.stop());
    supportLocalAudio = null;
  }
  supportPendingCandidates = [];
  document.querySelector("#supportRemoteAudio").srcObject = null;
  document.querySelector("#endSupportCall").hidden = true;
  document.querySelector("#startSupportCall").hidden = false;
}

function sendCustomerSignal(callId, type, payload) {
  return appRequest(`/api/support/calls/${encodeURIComponent(callId)}/signals`, {
    method: "POST",
    body: JSON.stringify({ type, payload })
  });
}

async function addCustomerRemoteCandidate(candidate) {
  if (!supportCallPeer || !supportCallPeer.remoteDescription) {
    supportPendingCandidates.push(candidate);
    return;
  }
  await supportCallPeer.addIceCandidate(new RTCIceCandidate(candidate));
}

function createCustomerPeer(callId) {
  supportCallPeer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  supportCallPeer.onicecandidate = event => {
    if (!event.candidate) return;
    sendCustomerSignal(callId, "candidate", event.candidate.toJSON())
      .catch(error => setSupportFeedback(error.message, true));
  };
  supportCallPeer.ontrack = event => {
    document.querySelector("#supportRemoteAudio").srcObject = event.streams[0];
  };
  supportCallPeer.onconnectionstatechange = () => {
    if (supportCallPeer && supportCallPeer.connectionState === "connected") {
      document.querySelector("#supportCallStatus").textContent = "Connected to customer care.";
    }
    if (supportCallPeer && ["failed", "disconnected"].includes(supportCallPeer.connectionState)) {
      document.querySelector("#supportCallStatus").textContent = "Call connection lost. End the call and try again.";
    }
  };
}

async function processCustomerCall(call) {
  const status = document.querySelector("#supportCallStatus");
  if (!call) {
    status.textContent = "Our team is available to help.";
    closeCustomerCall();
    supportCallId = "";
    return;
  }
  if (supportCallId && supportCallId !== call.id) closeCustomerCall();
  supportCallId = call.id;
  if (call.status === "ended") {
    status.textContent = "Call ended.";
    closeCustomerCall();
    supportCallId = "";
    return;
  }
  document.querySelector("#startSupportCall").hidden = true;
  document.querySelector("#endSupportCall").hidden = false;
  status.textContent = call.status === "active" ? "Connecting your audio call..." : "Calling customer care...";
  for (const signal of call.signals) {
    if (signal.senderRole === "customer" || supportSeenSignals.has(signal.id)) continue;
    supportSeenSignals.add(signal.id);
    if (signal.type === "answer" && supportCallPeer && !supportCallPeer.remoteDescription) {
      await supportCallPeer.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: signal.payload }));
      const candidates = supportPendingCandidates;
      supportPendingCandidates = [];
      for (const candidate of candidates) await addCustomerRemoteCandidate(candidate);
    } else if (signal.type === "candidate") {
      await addCustomerRemoteCandidate(signal.payload);
    }
  }
}

async function loadCustomerSupport() {
  if (!appUser || supportPollPending) return;
  supportPollPending = true;
  try {
    const { thread } = await appRequest("/api/support");
    renderSupportMessages(thread);
    await processCustomerCall(thread.call);
    if (thread.call && thread.call.status === "active" && supportCallPeer &&
        ["connecting", "connected"].includes(supportCallPeer.connectionState) &&
        Date.now() - supportLastHeartbeatAt >= 10000) {
      supportLastHeartbeatAt = Date.now();
      await appRequest("/api/support/calls", {
        method: "POST",
        body: JSON.stringify({ action: "heartbeat", callId: thread.call.id })
      });
    }
  } finally {
    supportPollPending = false;
  }
}

document.querySelector("#supportMessageForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.elements.namedItem("text");
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await appRequest("/api/support/messages", {
      method: "POST",
      body: JSON.stringify({ text: input.value })
    });
    input.value = "";
    setSupportFeedback("");
    await loadCustomerSupport();
  } catch (error) {
    setSupportFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#startSupportCall").addEventListener("click", async event => {
  const button = event.currentTarget;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) {
    setSupportFeedback("Audio calling needs a supported browser and a secure HTTPS connection.", true);
    return;
  }
  button.disabled = true;
  try {
    supportLocalAudio = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const { call } = await appRequest("/api/support/calls", {
      method: "POST",
      body: JSON.stringify({ action: "start" })
    });
    supportCallId = call.id;
    supportSeenSignals = new Set();
    createCustomerPeer(call.id);
    supportLocalAudio.getTracks().forEach(track => supportCallPeer.addTrack(track, supportLocalAudio));
    const offer = await supportCallPeer.createOffer();
    await supportCallPeer.setLocalDescription(offer);
    await sendCustomerSignal(call.id, "offer", offer.sdp);
    document.querySelector("#supportCallStatus").textContent = "Calling customer care...";
    button.hidden = true;
    document.querySelector("#endSupportCall").hidden = false;
    setSupportFeedback("Allow microphone access and keep this page open while you call.");
    await loadCustomerSupport();
  } catch (error) {
    closeCustomerCall();
    if (supportCallId) {
      try {
        await appRequest("/api/support/calls", {
          method: "POST",
          body: JSON.stringify({ action: "end", callId: supportCallId })
        });
      } catch (cleanupError) {
        console.error("Could not end the support call after setup failed:", cleanupError);
      }
    }
    supportCallId = "";
    setSupportFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#endSupportCall").addEventListener("click", async () => {
  const callId = supportCallId;
  closeCustomerCall();
  if (!callId) return;
  try {
    await appRequest("/api/support/calls", {
      method: "POST",
      body: JSON.stringify({ action: "end", callId })
    });
    document.querySelector("#supportCallStatus").textContent = "Call ended.";
    supportCallId = "";
  } catch (error) {
    setSupportFeedback(error.message, true);
  }
});

function showOrderStatus(status) {
  return ({
    pending_payment: "Awaiting payment",
    payment_reported: "Payment reported",
    confirmed: "Payment confirmed",
    shipping: "Preparing for shipment",
    in_transit: "In transit",
    delivered: "Delivered",
    cancelled: "Cancelled"
  })[status] || status || "Order received";
}

function renderOrders(orders) {
  const list = document.querySelector("#appOrderList");
  list.replaceChildren();
  if (!appUser) {
    const message = document.createElement("div");
    const text = document.createElement("p");
    const signIn = document.createElement("button");
    message.className = "app-empty";
    text.textContent = "Sign in to see your order history.";
    signIn.type = "button";
    signIn.className = "app-primary-button";
    signIn.textContent = "Sign in";
    signIn.addEventListener("click", () => openAuth("login"));
    message.append(text, signIn);
    list.append(message);
    return;
  }
  if (!orders.length) {
    const empty = document.createElement("p");
    empty.className = "app-empty";
    empty.textContent = "No orders yet. Your next gadget can start here.";
    list.append(empty);
    return;
  }
  orders.forEach(order => {
    const card = document.createElement("article");
    const head = document.createElement("div");
    const title = document.createElement("h2");
    const state = document.createElement("span");
    const date = document.createElement("p");
    const items = document.createElement("p");
    const address = document.createElement("p");
    const footer = document.createElement("div");
    const total = document.createElement("strong");
    card.className = "app-order-card";
    head.className = "app-order-card-head";
    title.textContent = `Order ${String(order.id).slice(0, 8).toUpperCase()}`;
    state.className = `app-order-state ${order.status === "delivered" ? "complete" : ""}`;
    state.textContent = showOrderStatus(order.status);
    head.append(title, state);
    date.textContent = `Placed ${new Date(order.createdAt).toLocaleString()}`;
    items.textContent = Array.isArray(order.items)
      ? order.items.map(item => `${item.name} × ${item.quantity}`).join(", ")
      : "";
    address.textContent = `Delivery address: ${order.shippingAddress || "Not provided"}`;
    footer.className = "app-order-card-footer";
    total.textContent = `${formatAppMoney(order.total)} · ${order.paymentStatus || "Awaiting payment"}`;
    footer.append(total);
    if (order.status === "pending_payment") {
      const paid = document.createElement("button");
      paid.type = "button";
      paid.textContent = "I have paid";
      paid.addEventListener("click", async () => {
        paid.disabled = true;
        try {
          await appRequest(`/api/orders/${encodeURIComponent(order.id)}/payment-reported`, { method: "POST", body: "{}" });
          await loadAppOrders();
          setAppFeedback("Payment reported. The store will verify the transfer.");
        } catch (error) {
          paid.disabled = false;
          setAppFeedback(error.message, true);
        }
      });
      footer.append(paid);
    }
    card.append(head, date, items, address, footer);
    list.append(card);
  });
}

async function loadAppOrders() {
  if (!appUser) {
    renderOrders([]);
    return;
  }
  const orders = await appRequest("/api/orders");
  renderOrders(orders);
}

function openCart() {
  if (appCartOverlay.hidden) appViewBeforeCart = activeAppView;
  activeAppView = "bag";
  renderCart();
  appCartOverlay.hidden = false;
  document.body.classList.add("cart-open");
  document.querySelectorAll("[data-app-view]").forEach(button => {
    const active = button.dataset.appView === "bag";
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
}

function closeCart() {
  appCartOverlay.hidden = true;
  document.body.classList.remove("cart-open");
  if (activeAppView === "bag") activeAppView = appViewBeforeCart;
  document.querySelectorAll("[data-app-view]").forEach(button => {
    const active = button.dataset.appView === activeAppView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
}

function currentCheckoutQuoteKey() {
  const address = appCheckoutForm.elements.namedItem("address").value.trim().toLowerCase();
  const items = appCart.map(item => `${item.id}:${item.quantity}`).sort().join("|");
  return `${address}::${items}`;
}

async function updateCheckoutQuote() {
  const key = currentCheckoutQuoteKey();
  const version = ++quoteVersion;
  activeQuoteKey = "";
  document.querySelector("#placeAppOrder").disabled = true;
  if (appCart.length === 0 || appCheckoutForm.elements.namedItem("address").value.trim().length < 5) {
    setCheckoutFeedback("Enter a complete delivery address to calculate the total.");
    document.querySelector("#checkoutSubtotal").textContent = "—";
    document.querySelector("#checkoutDelivery").textContent = "—";
    document.querySelector("#checkoutTotal").textContent = "—";
    document.querySelector("#checkoutItems").replaceChildren();
    return;
  }
  setCheckoutFeedback("Calculating delivery and total...");
  try {
    const quote = await appRequest("/api/orders/quote", {
      method: "POST",
      body: JSON.stringify({
        items: appCart.map(item => ({ id: item.id, quantity: item.quantity })),
        address: appCheckoutForm.elements.namedItem("address").value.trim()
      })
    });
    if (version !== quoteVersion || key !== currentCheckoutQuoteKey()) return;
    const itemList = document.querySelector("#checkoutItems");
    itemList.replaceChildren();
    quote.items.forEach(item => {
      const row = document.createElement("div");
      const name = document.createElement("span");
      const amount = document.createElement("strong");
      name.textContent = `${item.name} × ${item.quantity}`;
      amount.textContent = formatAppMoney(Number(item.price) * Number(item.quantity));
      row.append(name, amount);
      itemList.append(row);
    });
    document.querySelector("#checkoutSubtotal").textContent = formatAppMoney(quote.subtotal);
    document.querySelector("#checkoutDeliveryLabel").textContent = quote.deliveryZoneLabel || "Delivery";
    document.querySelector("#checkoutDelivery").textContent = formatAppMoney(quote.deliveryFee);
    document.querySelector("#checkoutTotal").textContent = formatAppMoney(quote.total);
    setCheckoutFeedback("Delivery price and order total are up to date.");
    activeQuoteKey = key;
    document.querySelector("#placeAppOrder").disabled = false;
  } catch (error) {
    if (version !== quoteVersion) return;
    setCheckoutFeedback(error.message, true);
  }
}

async function openCheckout() {
  if (appCart.length === 0) {
    closeCart();
    setAppFeedback("Add a gadget to your bag before checking out.", true);
    return;
  }
  if (!appUser) {
    closeCart();
    openAuth("login");
    setAuthFeedback("Sign in or create an account to place your order.");
    return;
  }
  checkoutReturnView = appViewBeforeCart;
  closeCart();
  activeAppView = "bag";
  document.querySelectorAll("[data-app-view]").forEach(button => {
    const active = button.dataset.appView === "bag";
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  appCheckoutForm.hidden = false;
  appPaymentConfirmation.hidden = true;
  appCheckoutForm.reset();
  appCheckoutForm.elements.namedItem("name").value = appUser.name;
  appCheckoutForm.elements.namedItem("email").value = appUser.email;
  appCheckoutForm.elements.namedItem("phone").value = appUser.phone || "";
  appCheckoutForm.elements.namedItem("address").value = appUser.address || "";
  paymentOrderId = "";
  appCheckoutOverlay.hidden = false;
  document.body.classList.add("checkout-open");
  await updateCheckoutQuote();
}

function closeCheckout() {
  appCheckoutOverlay.hidden = true;
  document.body.classList.remove("checkout-open");
  quoteVersion += 1;
  if (activeAppView === "bag") {
    activeAppView = checkoutReturnView;
    document.querySelectorAll("[data-app-view]").forEach(button => {
      const active = button.dataset.appView === activeAppView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
  }
}

function displayPaymentConfirmation(order, paymentDetails) {
  appCheckoutForm.hidden = true;
  appPaymentConfirmation.hidden = false;
  paymentOrderId = order.id;
  document.querySelector("#appPaymentOrderId").textContent =
    `Order ${order.id} · Total ${formatAppMoney(order.total)}`;
  document.querySelector("#appPaymentBank").textContent = paymentDetails.bankName;
  document.querySelector("#appPaymentName").textContent = paymentDetails.accountName;
  document.querySelector("#appPaymentNumber").textContent = paymentDetails.accountNumber;
  document.querySelector("#appPaymentFeedback").textContent = "Use the exact order total as your bank transfer amount.";
  document.querySelector("#reportAppPayment").disabled = false;
}

appLoginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = appLoginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await appRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(appLoginForm)))
    });
    if (!result.user || result.user.role !== "customer") throw new Error("This sign-in is not a customer account.");
    await setAppUser(result.user);
    appLoginForm.reset();
    setAuthFeedback("");
  } catch (error) {
    setAuthFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
});

appRegisterForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = appRegisterForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await appRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(appRegisterForm)))
    });
    await setAppUser(result.user);
    appRegisterForm.reset();
    setAppFeedback("Your customer account is ready.");
  } catch (error) {
    const message = error.status === 409
      ? "An account with this email already exists. Sign in with that account instead."
      : error.message;
    setAuthFeedback(message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#appShowLogin").addEventListener("click", () => setAuthMode("login"));
document.querySelector("#appShowRegister").addEventListener("click", () => setAuthMode("register"));
document.querySelector("#appSignIn").addEventListener("click", () => openAuth("login"));
document.querySelector("#closeAppAuth").addEventListener("click", () => { appAuth.hidden = true; });
document.querySelectorAll("[data-open-auth]").forEach(button => {
  button.addEventListener("click", () => openAuth(button.dataset.openAuth));
});
document.querySelectorAll("[data-app-view]").forEach(button => {
  button.addEventListener("click", () => showAppView(button.dataset.appView));
});
document.querySelector("[data-scroll-products]").addEventListener("click", () => {
  document.querySelector("#appTopPicks").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#appSearch").addEventListener("input", () => {
  appCurrentPage = 1;
  renderProducts();
});
appProductGrid.addEventListener("click", event => {
  const button = event.target.closest("[data-add-product]");
  if (button) {
    const product = appProducts.find(item => item.id === button.dataset.addProduct);
    if (product) addToCart(product);
  }
});
document.querySelector("#openCart").addEventListener("click", openCart);
document.querySelectorAll("[data-close-cart]").forEach(button => button.addEventListener("click", closeCart));
appCartOverlay.addEventListener("click", event => {
  if (event.target === appCartOverlay) closeCart();
});
document.querySelector("#appCartList").addEventListener("click", event => {
  const button = event.target.closest("[data-cart-action]");
  if (!button) return;
  changeCartQuantity(button.dataset.productId, button.dataset.cartAction === "increase" ? 1 : -1);
});
document.querySelector("#startCheckout").addEventListener("click", openCheckout);
document.querySelectorAll("[data-close-checkout]").forEach(button => {
  button.addEventListener("click", closeCheckout);
});
appCheckoutOverlay.addEventListener("click", event => {
  if (event.target === appCheckoutOverlay) closeCheckout();
});
appCheckoutForm.elements.namedItem("address").addEventListener("input", () => {
  window.clearTimeout(quoteTimer);
  quoteTimer = window.setTimeout(updateCheckoutQuote, 450);
});
appCheckoutForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (activeQuoteKey !== currentCheckoutQuoteKey()) {
    await updateCheckoutQuote();
    return;
  }
  const button = document.querySelector("#placeAppOrder");
  button.disabled = true;
  setCheckoutFeedback("Placing your order...");
  try {
    const values = Object.fromEntries(new FormData(appCheckoutForm));
    const result = await appRequest("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        items: appCart.map(item => ({ id: item.id, quantity: item.quantity })),
        name: values.name,
        phone: values.phone,
        address: values.address
      })
    });
    appCart = [];
    saveCart();
    renderCart();
    displayPaymentConfirmation(result.order, result.paymentDetails);
    setAppFeedback("");
  } catch (error) {
    setCheckoutFeedback(error.message, true);
    button.disabled = false;
  }
});
document.querySelector("#reportAppPayment").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await appRequest(`/api/orders/${encodeURIComponent(paymentOrderId)}/payment-reported`, { method: "POST", body: "{}" });
    document.querySelector("#appPaymentFeedback").textContent = "Payment reported. The store will verify the transfer.";
    await loadAppOrders();
  } catch (error) {
    document.querySelector("#appPaymentFeedback").textContent = error.message;
    button.disabled = false;
  }
});
document.querySelector("#finishCheckout").addEventListener("click", () => {
  closeCheckout();
  showAppView("orders");
  setAppFeedback("Your order is saved. You can follow updates in My orders.");
});
document.querySelector("#appLogout").addEventListener("click", async () => {
  try {
    if (supportCallId) {
      try {
        await appRequest("/api/support/calls", {
          method: "POST",
          body: JSON.stringify({ action: "end", callId: supportCallId })
        });
      } catch (callError) {
        console.error("Could not end the support call before signing out:", callError);
      }
    }
    await appRequest("/api/auth/logout", { method: "POST", body: "{}" });
    window.clearInterval(supportPollTimer);
    supportPollTimer = null;
    closeCustomerCall();
    supportCallId = "";
    appUser = null;
    refreshAccountPanel();
    renderOrders([]);
    setAppFeedback("You have signed out.");
  } catch (error) {
    setAppFeedback(error.message, true);
  }
});

loadSavedCart();
renderCart();
appShell.hidden = false;
loadProducts().catch(error => {
  console.error("Could not load products in the shop app:", error);
  appProductGrid.replaceChildren();
  const message = document.createElement("p");
  message.className = "app-empty";
  message.textContent = "Products could not be loaded. Check your connection and try again.";
  appProductGrid.append(message);
});
appRequest("/api/auth/session")
  .then(result => {
    if (result.user && result.user.role === "customer") return setAppUser(result.user);
    if (result.user) setAppFeedback("Another type of account is signed in in this browser. Sign it out before using the shopping app.", true);
    else {
      appUser = null;
      refreshAccountPanel();
      renderOrders([]);
      if (new URLSearchParams(window.location.search).get("view") === "support") showAppView("support");
    }
  })
  .catch(error => {
    appUser = null;
    refreshAccountPanel();
    renderOrders([]);
    setAppFeedback(error.message, true);
  });
