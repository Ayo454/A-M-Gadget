const riderStatus = document.querySelector("#riderStatus");
const riderAuth = document.querySelector("#riderAuth");
const riderDashboard = document.querySelector("#riderDashboard");
const riderLoginForm = document.querySelector("#riderLoginForm");
const riderRegisterForm = document.querySelector("#riderRegisterForm");
let riderData = null;

async function riderRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`The rider server returned an unexpected page (HTTP ${response.status}). Refresh or ask the store to update the hosted app.`);
  }
  if (!response.ok) {
    const error = new Error(result.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function showRiderStatus(message, isError = false) {
  riderStatus.textContent = message;
  riderStatus.classList.toggle("error", isError);
}

function setRiderMode(mode) {
  const registering = mode === "register";
  riderLoginForm.hidden = registering;
  riderRegisterForm.hidden = !registering;
  document.querySelector("#riderShowLogin").classList.toggle("active", !registering);
  document.querySelector("#riderShowRegister").classList.toggle("active", registering);
  document.querySelector("#riderShowLogin").setAttribute("aria-selected", String(!registering));
  document.querySelector("#riderShowRegister").setAttribute("aria-selected", String(registering));
  showRiderStatus("");
}

function showRiderView(view) {
  document.querySelectorAll("[data-rider-panel]").forEach(panel => {
    panel.hidden = panel.dataset.riderPanel !== view;
  });
  document.querySelectorAll("[data-rider-view]").forEach(button => {
    const active = button.dataset.riderView === view;
    button.classList.toggle("active", active);
    if (button.closest(".rider-sidebar")) button.setAttribute("aria-current", active ? "page" : "false");
  });
}

function formatRiderMoney(value) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function riderStatusLabel(status) {
  return ({
    shipping: "Assigned",
    in_transit: "In transit",
    delivered: "Delivered",
    cancelled: "Cancelled"
  })[status] || status;
}

function createRiderEmpty(message) {
  const empty = document.createElement("p");
  empty.className = "rider-empty";
  empty.textContent = message;
  return empty;
}

function appendRiderLine(parent, text, className = "") {
  const line = document.createElement("p");
  if (className) line.className = className;
  line.textContent = text;
  parent.append(line);
}

function renderRiderOrder(order) {
  const card = document.createElement("article");
  const heading = document.createElement("div");
  const title = document.createElement("h3");
  const status = document.createElement("span");
  const feedback = document.createElement("p");
  card.className = "rider-order-card";
  heading.className = "rider-order-card-head";
  title.textContent = `Order ${String(order.id).slice(0, 8).toUpperCase()}`;
  status.className = `rider-order-status ${order.status === "delivered" ? "delivered" : ""}`;
  status.textContent = riderStatusLabel(order.status);
  heading.append(title, status);
  card.append(heading);
  appendRiderLine(card, `Recipient: ${order.recipientName || "Customer"} · ${order.recipientPhone || "No phone"}`, "rider-order-meta");
  appendRiderLine(card, `Delivery address: ${order.shippingAddress || "No address provided"}`);
  const items = Array.isArray(order.items)
    ? order.items.map(item => `${item.name} × ${item.quantity}`).join(", ")
    : "";
  if (items) appendRiderLine(card, `Items: ${items}`);
  appendRiderLine(card, `Delivery fee: ${formatRiderMoney(order.deliveryFee)} · Your commission: ${formatRiderMoney(order.riderCommission)}`);
  feedback.className = "rider-order-feedback";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");

  if (order.status === "shipping") {
    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.className = "button button-primary";
    startButton.textContent = "Start delivery";
    startButton.addEventListener("click", async () => {
      startButton.disabled = true;
      try {
        await riderRequest(`/api/rider/orders/${encodeURIComponent(order.id)}/start`, { method: "PATCH", body: "{}" });
        await loadRiderDashboard();
        showRiderView("deliveries");
      } catch (error) {
        feedback.textContent = error.message;
        feedback.classList.add("error");
        startButton.disabled = false;
      }
    });
    card.append(startButton);
  }

  if (order.status === "in_transit") {
    const requestButton = document.createElement("button");
    requestButton.type = "button";
    requestButton.className = "button button-primary";
    requestButton.textContent = "Send code to customer";
    requestButton.addEventListener("click", async () => {
      requestButton.disabled = true;
      feedback.classList.remove("error");
      feedback.textContent = "Sending code by email and SMS...";
      try {
        const result = await riderRequest(`/api/rider/orders/${encodeURIComponent(order.id)}/request-code`, {
          method: "POST",
          body: "{}"
        });
        feedback.textContent = result.message;
        window.setTimeout(() => { requestButton.disabled = false; }, 60000);
      } catch (error) {
        feedback.textContent = error.message;
        feedback.classList.add("error");
        requestButton.disabled = false;
      }
    });
    card.append(requestButton);

    const codeForm = document.createElement("form");
    const codeInput = document.createElement("input");
    const verifyButton = document.createElement("button");
    codeForm.className = "rider-code-form";
    codeInput.type = "text";
    codeInput.name = "code";
    codeInput.inputMode = "numeric";
    codeInput.pattern = "[0-9]{6}";
    codeInput.maxLength = 6;
    codeInput.autocomplete = "one-time-code";
    codeInput.placeholder = "6-digit customer code";
    codeInput.setAttribute("aria-label", "Customer's 6-digit delivery code");
    codeInput.required = true;
    verifyButton.type = "submit";
    verifyButton.textContent = "Verify & complete";
    codeForm.append(codeInput, verifyButton);
    codeForm.addEventListener("submit", async event => {
      event.preventDefault();
      verifyButton.disabled = true;
      feedback.classList.remove("error");
      feedback.textContent = "Verifying delivery...";
      try {
        await riderRequest(`/api/rider/orders/${encodeURIComponent(order.id)}/verify-code`, {
          method: "POST",
          body: JSON.stringify({ code: codeInput.value })
        });
        await loadRiderDashboard();
        showRiderView("deliveries");
        showRiderStatus("Delivery confirmed. Your commission has been added to your earnings.");
      } catch (error) {
        feedback.textContent = error.message;
        feedback.classList.add("error");
        verifyButton.disabled = false;
      }
    });
    card.append(codeForm);
  }

  card.append(feedback);
  return card;
}

function renderRiderOrders() {
  const allOrders = riderData.orders || [];
  const activeOrders = allOrders.filter(order => !["delivered", "cancelled"].includes(order.status));
  const nextOrder = activeOrders[0];
  const routeBadge = document.querySelector("#riderRouteBadge");
  const routeRecipient = document.querySelector("#riderRouteRecipient");
  const routeAddress = document.querySelector("#riderRouteAddress");
  const directions = document.querySelector("#riderDirections");
  if (nextOrder) {
    routeBadge.textContent = riderStatusLabel(nextOrder.status);
    routeRecipient.textContent = nextOrder.recipientName || "Customer";
    routeAddress.textContent = nextOrder.shippingAddress || "No delivery address provided.";
    directions.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nextOrder.shippingAddress || "")}`;
    directions.hidden = !nextOrder.shippingAddress;
  } else {
    routeBadge.textContent = "No active route";
    routeRecipient.textContent = "No delivery assigned";
    routeAddress.textContent = "Your next assigned delivery will appear here.";
    directions.removeAttribute("href");
    directions.hidden = true;
  }
  const destinations = [
    [document.querySelector("#riderOrders"), activeOrders, "You have no active deliveries."],
    [document.querySelector("#riderRecentOrders"), allOrders.slice(0, 3), "No deliveries have been assigned yet."]
  ];
  destinations.forEach(([container, orders, emptyText]) => {
    container.replaceChildren();
    if (!orders.length) container.append(createRiderEmpty(emptyText));
    orders.forEach(order => container.append(renderRiderOrder(order)));
  });
}

function renderRiderPayouts() {
  const { earnings, payouts } = riderData;
  document.querySelector("#riderTotalEarned").textContent = formatRiderMoney(earnings.earned);
  document.querySelector("#riderAvailableBalance").textContent = formatRiderMoney(earnings.availableBalance);
  document.querySelector("#riderAccountEnding").textContent = `Account ending ${earnings.accountLastFour}`;
  const payoutButton = document.querySelector("#requestPayout");
  const payoutMessage = document.querySelector("#riderPayoutMessage");
  payoutButton.disabled = !earnings.canRequestPayout;
  payoutMessage.textContent = earnings.canRequestPayout
    ? `Available balance for ${earnings.weekKey}. One request is allowed each week.`
    : earnings.availableBalance <= 0
      ? "Complete deliveries to build an available balance."
      : `A payout request has already been submitted for ${earnings.weekKey}.`;

  const history = document.querySelector("#riderPayoutHistory");
  history.replaceChildren();
  if (!payouts.length) history.append(createRiderEmpty("No payout requests yet."));
  payouts.forEach(payout => {
    const item = document.createElement("div");
    const description = document.createElement("span");
    const amount = document.createElement("strong");
    item.className = "rider-payout-item";
    description.textContent = `${payout.weekKey} · ${payout.status}`;
    amount.textContent = formatRiderMoney(payout.amount);
    item.append(description, amount);
    history.append(item);
  });
}

async function loadRiderDashboard() {
  const result = await riderRequest("/api/rider/dashboard");
  riderData = result;
  riderAuth.hidden = true;
  riderDashboard.hidden = false;
  document.querySelector("#riderName").textContent = result.rider.name;
  document.querySelector("#riderAccountName").textContent = result.rider.name || "—";
  document.querySelector("#riderAccountEmail").textContent = result.rider.email || "—";
  document.querySelector("#riderAccountPhone").textContent = result.rider.phone || "—";
  document.querySelector("#riderAccountVehicle").textContent = result.rider.vehicleType || "—";
  document.querySelector("#riderAccountNumber").textContent =
    `Account ending ${result.earnings.accountLastFour || "••••"}`;
  const activeOrders = result.orders.filter(order => !["delivered", "cancelled"].includes(order.status));
  const completedOrders = result.orders.filter(order => order.status === "delivered");
  document.querySelector("#riderAvailabilityLabel").textContent =
    activeOrders.length ? "On delivery" : "Ready to ride";
  document.querySelector("#riderActiveCount").textContent = String(activeOrders.length);
  document.querySelector("#riderDeliveredCount").textContent = String(completedOrders.length);
  document.querySelector("#riderBalance").textContent = formatRiderMoney(result.earnings.availableBalance);
  renderRiderOrders();
  renderRiderPayouts();
}

document.querySelector("#riderShowLogin").addEventListener("click", () => setRiderMode("login"));
document.querySelector("#riderShowRegister").addEventListener("click", () => setRiderMode("register"));
riderLoginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const submitButton = riderLoginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await riderRequest("/api/rider/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(riderLoginForm)))
    });
    await loadRiderDashboard();
    showRiderStatus("");
  } catch (error) {
    showRiderStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

riderRegisterForm.addEventListener("submit", async event => {
  event.preventDefault();
  const submitButton = riderRegisterForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const result = await riderRequest("/api/rider/register", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(riderRegisterForm)))
    });
    riderRegisterForm.reset();
    setRiderMode("login");
    showRiderStatus(result.message || "Application received. We will email you after review.");
  } catch (error) {
    const message = error.status === 409
      ? "An account with this email already exists. If you already applied as a rider, choose Sign in; otherwise use a different email address."
      : error.message;
    showRiderStatus(message, true);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelectorAll("[data-rider-view]").forEach(button => {
  button.addEventListener("click", () => showRiderView(button.dataset.riderView));
});

document.querySelector("#requestPayout").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await riderRequest("/api/rider/payout-requests", { method: "POST", body: "{}" });
    await loadRiderDashboard();
    showRiderView("earnings");
    showRiderStatus("Your weekly payout request has been sent to the store admin.");
  } catch (error) {
    document.querySelector("#riderPayoutMessage").textContent = error.message;
    button.disabled = false;
  }
});

document.querySelector("#riderLogout").addEventListener("click", async () => {
  try {
    await riderRequest("/api/auth/logout", { method: "POST", body: "{}" });
    riderDashboard.hidden = true;
    riderAuth.hidden = false;
    riderLoginForm.reset();
    showRiderStatus("You have signed out.");
  } catch (error) {
    showRiderStatus(error.message, true);
  }
});

riderRequest("/api/auth/session")
  .then(result => {
    if (result.user && result.user.role === "rider") return loadRiderDashboard();
    if (result.user) {
      showRiderStatus("Another account is signed in in this browser. Sign it out before using the rider portal.", true);
    }
  })
  .catch(error => showRiderStatus(error.message, true));
