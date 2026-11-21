let products = [];
const productGrid = document.querySelector("#productGrid");
const productLimit = Number(productGrid.dataset.limit);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatPrice(value) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value));
}

function priceAmount(value) {
  const amount = typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function renderProducts() {
  const displayedProducts = products
    .map((product, index) => ({ product, index }))
    .slice(0, productLimit > 0 ? productLimit : products.length);
  productGrid.innerHTML = displayedProducts.map(({ product, index }) => `
    <article class="product-card" data-index="${index}">
      <div class="product-image">
        ${product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span>` : ""}
        <button class="wishlist" aria-label="Add ${escapeHtml(product.name)} to wishlist">♡</button>
        <a class="product-image-link" href="product.html?id=${encodeURIComponent(product.id)}" aria-label="View ${escapeHtml(product.name)} details">
          <img class="product-card-image" src="${escapeHtml(product.image || `/images/products/${product.type}.jpg`)}" data-fallback="/images/products/${escapeHtml(product.type)}.jpg" alt="${escapeHtml(product.name)}" loading="lazy">
        </a>
      </div>
      <div class="product-info">
        <span class="product-category">${escapeHtml(product.category)}</span>
        <h3><a href="product.html?id=${encodeURIComponent(product.id)}">${escapeHtml(product.name)}</a></h3>
        <div class="product-bottom">
          <div class="product-price">${formatPrice(product.price)} ${product.oldPrice ? `<del>${formatPrice(product.oldPrice)}</del>` : ""}</div>
          <button class="add-button" aria-label="Add ${escapeHtml(product.name)} to bag" data-index="${index}">+</button>
        </div>
      </div>
    </article>
  `).join("");
  productGrid.querySelectorAll(".product-card-image").forEach(image => {
    image.addEventListener("error", () => {
      image.src = image.dataset.fallback;
    }, { once: true });
  });
}

async function loadProducts() {
  try {
    const response = await fetch("/api/products");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Products could not be loaded.");
    products = result;
    renderProducts();
  } catch (error) {
    console.error("Could not load products:", error);
    productGrid.innerHTML = `<p class="product-load-error">Products could not be loaded. Start the website server and refresh the page.</p>`;
  }
}

const cartStorageKey = "boluwatife-gadget-cart";

function readSavedBag() {
  try {
    const savedBag = JSON.parse(sessionStorage.getItem(cartStorageKey) || "[]");
    return Array.isArray(savedBag) ? savedBag : [];
  } catch (error) {
    console.error("Could not restore the shopping bag:", error);
    return [];
  }
}

const bag = readSavedBag();
let cartCount = bag.length;
const cartBadge = document.querySelector(".cart-count");
const toast = document.querySelector(".toast");
const cartTitleCount = document.querySelector(".cart-title-count");
const cartItems = document.querySelector(".cart-items");
const cartSubtotal = document.querySelector(".cart-subtotal");
const cartDrawer = document.querySelector(".cart-drawer");
const drawerOverlay = document.querySelector(".drawer-overlay");
const bagButton = document.querySelector(".bag-button");
cartBadge.textContent = cartCount;
cartTitleCount.textContent = cartCount;

function saveBag() {
  try {
    sessionStorage.setItem(cartStorageKey, JSON.stringify(bag));
  } catch (error) {
    console.error("Could not save the shopping bag:", error);
    showToast("Your bag could not be saved in this browser tab.");
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function addToBag(product, name) {
  cartCount += 1;
  cartBadge.textContent = cartCount;
  cartTitleCount.textContent = cartCount;
  bag.push({ ...product, price: Number(product.price) });
  saveBag();
  renderCart();
  showToast(`${name} added to your bag`);
}

productGrid.addEventListener("click", event => {
  const button = event.target.closest(".add-button, .wishlist");
  if (!button) return;
  if (button.classList.contains("wishlist")) {
    button.classList.toggle("active");
    button.textContent = button.classList.contains("active") ? "♥" : "♡";
    return;
  }
  const product = products[Number(button.dataset.index)];
  if (product) addToBag(product, product.name);
});

const featuredButton = document.querySelector(".add-featured");
if (featuredButton) {
  featuredButton.addEventListener("click", () => {
    addToBag({ id: "volt-studio-pro", name: featuredButton.dataset.name, price: 349 }, featuredButton.dataset.name);
  });
}

const menuButton = document.querySelector(".menu-button");
const nav = document.querySelector(".nav");
menuButton.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(open));
});

document.querySelectorAll(".nav a").forEach(link => {
  link.addEventListener("click", () => {
    nav.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
  });
});

document.querySelectorAll(".category-card").forEach(card => {
  card.addEventListener("click", () => {
    const category = card.dataset.category;
    document.querySelectorAll(".product-card").forEach(productCard => {
      const product = products[Number(productCard.dataset.index)];
      const matches =
        category === "Phones" ? product.category === "Smartphones" :
        category === "Laptops" ? product.category === "Laptops" :
        category === "Audio" ? product.category === "Headphones" :
        product.category === "Wearables";
      productCard.style.display = matches ? "" : "none";
    });
    document.querySelector("#products").scrollIntoView({ behavior: "smooth" });
  });
});

function renderCart() {
  if (!bag.length) {
    cartItems.innerHTML = `
      <div class="empty-cart">
        <span>0</span>
        <p>Your bag is empty</p>
        <a href="#products" class="button button-primary cart-shop-link">Explore products</a>
      </div>`;
  } else {
    cartItems.innerHTML = bag.map((item, index) => `
      <div class="cart-line">
        <div class="cart-thumb">V</div>
            <div><strong>${escapeHtml(item.name)}</strong><small>${formatPrice(priceAmount(item.price))}</small></div>
        <button class="remove-item" data-index="${index}" aria-label="Remove ${escapeHtml(item.name)}">&times;</button>
      </div>
    `).join("");
  }
  document.querySelectorAll(".remove-item").forEach(button => {
    button.addEventListener("click", () => {
      bag.splice(Number(button.dataset.index), 1);
      cartCount = bag.length;
      cartBadge.textContent = cartCount;
      cartTitleCount.textContent = cartCount;
      saveBag();
      renderCart();
    });
  });
  const total = bag.reduce((sum, item) => sum + priceAmount(item.price), 0);
  cartSubtotal.textContent = formatPrice(total);
}

function setCart(open) {
  cartDrawer.classList.toggle("open", open);
  drawerOverlay.classList.toggle("open", open);
  if (!open && cartDrawer.contains(document.activeElement)) bagButton.focus();
  cartDrawer.setAttribute("aria-hidden", String(!open));
  bagButton.setAttribute("aria-expanded", String(open));
  if (open) window.requestAnimationFrame(() => {
    if (cartDrawer.classList.contains("open")) document.querySelector(".cart-close").focus();
  });
}

bagButton.setAttribute("aria-expanded", "false");
bagButton.addEventListener("click", () => setCart(true));
document.querySelector(".cart-close").addEventListener("click", () => setCart(false));
drawerOverlay.addEventListener("click", () => setCart(false));

const checkoutButton = document.querySelector(".checkout-button");
const checkoutOverlay = document.querySelector("#checkoutOverlay");
const checkoutForm = document.querySelector("#checkoutForm");
const checkoutStatus = document.querySelector("#checkoutStatus");
const checkoutLoading = document.querySelector("#checkoutLoading");
const checkoutSignIn = document.querySelector("#checkoutSignIn");
const checkoutTransferDetails = document.querySelector("#checkoutTransferDetails");
const reportPaymentButton = document.querySelector("#reportPaymentButton");
const paymentReportStatus = document.querySelector("#paymentReportStatus");
const checkoutAddress = checkoutForm.elements.address;
const checkoutItems = document.querySelector("#checkoutItems");
const placeOrderButton = document.querySelector("#placeOrderButton");
let checkoutQuoteRequest = 0;
let checkoutQuote = null;
let checkoutQuoteAddress = "";
let checkoutQuotePromise = null;
let checkoutQuotePendingAddress = "";
let checkoutQuoteTimer = null;
let currentCheckoutOrderId = null;

async function checkoutRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || "The request could not be completed."), { status: response.status });
  return result;
}

function showCheckoutStatus(message, isError = false) {
  checkoutStatus.textContent = message;
  checkoutStatus.hidden = !message;
  checkoutStatus.classList.toggle("is-error", isError);
}

function getOrderItems() {
  const quantities = new Map();
  bag.forEach(item => quantities.set(item.id, (quantities.get(item.id) || 0) + 1));
  return Array.from(quantities, ([id, quantity]) => ({ id, quantity }));
}

function renderCheckoutQuote(quote) {
  checkoutItems.replaceChildren();
  quote.items.forEach(item => {
    const row = document.createElement("li");
    const name = document.createElement("span");
    const price = document.createElement("strong");
    name.textContent = `${item.name} × ${item.quantity}`;
    price.textContent = formatPrice(item.price * item.quantity);
    row.append(name, price);
    checkoutItems.append(row);
  });
  document.querySelector("#checkoutSubtotal").textContent = formatPrice(quote.subtotal);
  document.querySelector("#checkoutDeliveryLabel").textContent = `Delivery (${quote.deliveryZoneLabel})`;
  document.querySelector("#checkoutDelivery").textContent = formatPrice(quote.deliveryFee);
  document.querySelector("#checkoutTotal").textContent = formatPrice(quote.total);
}

async function updateCheckoutQuote() {
  const address = checkoutAddress.value.trim();
  if (checkoutQuote && checkoutQuoteAddress === address) return;
  if (checkoutQuotePromise && checkoutQuotePendingAddress === address) {
    await checkoutQuotePromise;
    return;
  }
  const requestNumber = ++checkoutQuoteRequest;
  checkoutQuote = null;
  placeOrderButton.disabled = true;
  if (address.length < 5) {
    document.querySelector("#checkoutSubtotal").textContent = "—";
    document.querySelector("#checkoutDeliveryLabel").textContent = "Delivery";
    document.querySelector("#checkoutDelivery").textContent = "—";
    document.querySelector("#checkoutTotal").textContent = "—";
    checkoutItems.replaceChildren();
    checkoutQuoteAddress = "";
    showCheckoutStatus("Enter a full delivery address to calculate the fee.");
    return;
  }
  showCheckoutStatus("Updating delivery and total...");
  document.querySelector("#checkoutDeliveryLabel").textContent = "Delivery";
  document.querySelector("#checkoutDelivery").textContent = "—";
  document.querySelector("#checkoutTotal").textContent = "—";
  const quotePromise = (async () => {
    try {
      const quote = await checkoutRequest("/api/orders/quote", {
        method: "POST",
        body: JSON.stringify({ items: getOrderItems(), address })
      });
      if (requestNumber !== checkoutQuoteRequest || checkoutOverlay.hidden) return;
      checkoutQuote = quote;
      checkoutQuoteAddress = address;
      renderCheckoutQuote(quote);
      showCheckoutStatus("");
      placeOrderButton.disabled = false;
    } catch (error) {
      if (requestNumber !== checkoutQuoteRequest) return;
      showCheckoutStatus(error.message, true);
    }
  })();
  checkoutQuotePromise = quotePromise;
  checkoutQuotePendingAddress = address;
  try {
    await quotePromise;
  } finally {
    if (checkoutQuotePromise === quotePromise) {
      checkoutQuotePromise = null;
      checkoutQuotePendingAddress = "";
    }
  }
}

async function openCheckout() {
  if (!bag.length) {
    showToast("Your bag is empty.");
    return;
  }
  checkoutButton.disabled = true;
  checkoutOverlay.hidden = false;
  checkoutForm.hidden = true;
  checkoutSignIn.hidden = true;
  document.querySelector("#checkoutConfirmation").hidden = true;
  checkoutTransferDetails.hidden = true;
  paymentReportStatus.hidden = true;
  reportPaymentButton.hidden = false;
  reportPaymentButton.disabled = false;
  currentCheckoutOrderId = null;
  checkoutLoading.hidden = false;
  showCheckoutStatus("");
  setCart(false);
  try {
    const checkout = await checkoutRequest("/api/checkout");
    checkoutForm.reset();
    checkoutForm.elements.name.value = checkout.user.name || "";
    checkoutForm.elements.email.value = checkout.user.email || "";
    checkoutForm.elements.phone.value = checkout.user.phone || "";
    checkoutForm.elements.address.value = checkout.user.address || "";
    checkoutLoading.hidden = true;
    checkoutForm.hidden = false;
    await updateCheckoutQuote();
    checkoutForm.elements.name.focus();
  } catch (error) {
    checkoutLoading.hidden = true;
    if (error.status === 401) {
      checkoutSignIn.hidden = false;
    } else {
      showCheckoutStatus(error.message, true);
    }
  } finally {
    checkoutButton.disabled = false;
  }
}

function closeCheckout(returnToBag = true) {
  window.clearTimeout(checkoutQuoteTimer);
  checkoutOverlay.hidden = true;
  checkoutQuoteRequest += 1;
  checkoutQuote = null;
  checkoutQuoteAddress = "";
  checkoutQuotePromise = null;
  checkoutQuotePendingAddress = "";
  if (returnToBag && bag.length) setCart(true);
  else setCart(false);
  checkoutButton.focus();
}

checkoutAddress.addEventListener("input", () => {
  window.clearTimeout(checkoutQuoteTimer);
  checkoutQuoteRequest += 1;
  checkoutQuote = null;
  checkoutQuoteAddress = "";
  checkoutQuotePromise = null;
  checkoutQuotePendingAddress = "";
  placeOrderButton.disabled = true;
  document.querySelector("#checkoutDeliveryLabel").textContent = "Delivery";
  document.querySelector("#checkoutDelivery").textContent = "—";
  document.querySelector("#checkoutTotal").textContent = "—";
  showCheckoutStatus("Delivery will calculate when you pause or finish typing.");
  checkoutQuoteTimer = window.setTimeout(updateCheckoutQuote, 1500);
});
checkoutAddress.addEventListener("change", () => {
  window.clearTimeout(checkoutQuoteTimer);
  updateCheckoutQuote();
});
checkoutForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!checkoutQuote) {
    await updateCheckoutQuote();
    return;
  }
  placeOrderButton.disabled = true;
  showCheckoutStatus("Placing your order...");
  try {
    const values = Object.fromEntries(new FormData(checkoutForm));
    const result = await checkoutRequest("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        items: getOrderItems(),
        address: values.address,
        name: values.name,
        phone: values.phone,
      })
    });
    bag.length = 0;
    cartCount = 0;
    cartBadge.textContent = "0";
    cartTitleCount.textContent = "0";
    saveBag();
    renderCart();
    checkoutForm.hidden = true;
    document.querySelector("#checkoutConfirmationMessage").textContent =
      `Order ${result.order.id} is pending payment. Total due: ${formatPrice(result.order.total)}.`;
    currentCheckoutOrderId = result.order.id;
    document.querySelector("#paymentBankName").textContent = result.paymentDetails.bankName;
    document.querySelector("#paymentAccountName").textContent = result.paymentDetails.accountName;
    document.querySelector("#paymentAccountNumber").textContent = result.paymentDetails.accountNumber;
    checkoutTransferDetails.hidden = false;
    document.querySelector("#checkoutConfirmation").hidden = false;
    showCheckoutStatus("");
  } catch (error) {
    showCheckoutStatus(error.message, true);
    placeOrderButton.disabled = false;
  }
});

reportPaymentButton.addEventListener("click", async () => {
  if (!currentCheckoutOrderId) return;
  reportPaymentButton.disabled = true;
  showCheckoutStatus("Reporting your payment...");
  try {
    await checkoutRequest(`/api/orders/${encodeURIComponent(currentCheckoutOrderId)}/payment-reported`, {
      method: "POST",
      body: "{}"
    });
    paymentReportStatus.textContent = "Payment reported. Your order is pending admin verification.";
    paymentReportStatus.hidden = false;
    reportPaymentButton.hidden = true;
    showCheckoutStatus("");
  } catch (error) {
    showCheckoutStatus(error.message, true);
    reportPaymentButton.disabled = false;
  }
});

document.querySelector("#checkoutClose").addEventListener("click", () => closeCheckout(true));
document.querySelector("#checkoutCancel").addEventListener("click", () => closeCheckout(true));
checkoutOverlay.addEventListener("click", event => {
  if (event.target === checkoutOverlay) closeCheckout(true);
});

checkoutButton.addEventListener("click", openCheckout);

const searchPanel = document.querySelector(".search-panel");
const productSearch = document.querySelector("#productSearch");

function setSearch(open) {
  searchPanel.classList.toggle("open", open);
  searchPanel.setAttribute("aria-hidden", String(!open));
  if (open) window.setTimeout(() => productSearch.focus(), 200);
}

document.querySelector(".search-button").addEventListener("click", () => setSearch(true));
document.querySelector(".search-close").addEventListener("click", () => setSearch(false));
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    setSearch(false);
    if (!checkoutOverlay.hidden) closeCheckout(true);
    else setCart(false);
  }
});
productSearch.addEventListener("input", event => {
  const term = event.target.value.trim().toLowerCase();
  let matches = 0;
  document.querySelectorAll(".product-card").forEach(card => {
    const product = products[Number(card.dataset.index)];
    const match = product && (!term || `${product.name} ${product.category}`.toLowerCase().includes(term));
    card.style.display = match ? "" : "none";
    if (match) matches += 1;
  });
  document.querySelector(".search-status").textContent =
    term ? `${matches} result${matches === 1 ? "" : "s"} found` : "Try “phones” or “laptop”";
});

renderCart();
loadProducts();
