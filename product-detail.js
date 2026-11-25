const detailRoot = document.querySelector("#productDetail");
const detailStatus = document.querySelector("#productDetailStatus");
const currency = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

function escapeDetailHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function showDetailError(message) {
  detailStatus.textContent = message;
  detailStatus.classList.add("error");
}

function renderProduct(product) {
  const fallbackImage = `/images/products/${product.type}.jpg`;
  const image = product.image || fallbackImage;
  const stock = Number.isInteger(product.stock) ? product.stock : null;
  const availability = stock === null ? "Stock not specified" :
    stock === 0 ? "Out of stock" : `${stock} available`;
  document.title = `${product.name} | A&M Gadget`;
  const canonicalUrl = new URL("/product.html", "https://amgadget.name.ng");
  canonicalUrl.searchParams.set("id", product.id);
  document.querySelector('link[rel="canonical"]').href = canonicalUrl.href;
  document.querySelector('meta[name="description"]').content =
    String(product.description || "Explore product details and shop online at A&M Gadget.").slice(0, 200);
  document.querySelector('meta[property="og:title"]').content = document.title;
  document.querySelector('meta[property="og:description"]').content =
    String(product.description || "Explore product details and shop online at A&M Gadget.").slice(0, 200);
  document.querySelector('meta[property="og:url"]').content = canonicalUrl.href;
  document.querySelector('meta[name="twitter:title"]').content = document.title;
  document.querySelector('meta[name="twitter:description"]').content =
    String(product.description || "Explore product details and shop online at A&M Gadget.").slice(0, 200);
  detailStatus.textContent = "";
  detailRoot.innerHTML = `
    <article class="product-detail">
      <div class="product-detail-image">
        <img id="detailProductImage" src="${escapeDetailHtml(image)}" data-fallback="${escapeDetailHtml(fallbackImage)}" alt="${escapeDetailHtml(product.name)}">
      </div>
      <div class="product-detail-copy">
        <p class="eyebrow dark"><span></span> ${escapeDetailHtml(product.category)}</p>
        ${product.badge ? `<span class="product-detail-badge">${escapeDetailHtml(product.badge)}</span>` : ""}
        <h1>${escapeDetailHtml(product.name)}</h1>
        <p class="product-detail-description">${escapeDetailHtml(product.description || "Contact the store for more information about this product.")}</p>
        <div class="product-detail-price">
          <strong>${currency.format(Number(product.price))}</strong>
          ${product.oldPrice ? `<del>${currency.format(Number(product.oldPrice))}</del>` : ""}
        </div>
        <dl class="product-detail-facts">
          <div><dt>Category</dt><dd>${escapeDetailHtml(product.category)}</dd></div>
          <div><dt>Product code</dt><dd>${escapeDetailHtml(product.id)}</dd></div>
          <div><dt>Availability</dt><dd>${escapeDetailHtml(availability)}</dd></div>
        </dl>
        <div class="product-detail-actions">
          <input class="product-quantity" id="productQuantity" type="number" min="1" max="${stock === null ? 1 : Math.max(1, Math.min(99, stock))}" value="1" aria-label="Quantity" ${stock === null || stock === 0 ? "disabled" : ""}>
          <button class="button button-primary" id="addDetailToBag" type="button" ${stock === null || stock === 0 ? "disabled" : ""}>Add to bag <span>→</span></button>
        </div>
        <p class="product-detail-feedback" id="productDetailFeedback" role="status" aria-live="polite"></p>
        <a class="product-detail-back" href="view%20all.html">← Continue shopping</a>
      </div>
    </article>
  `;

  const productImage = document.querySelector("#detailProductImage");
  productImage.addEventListener("error", () => {
    productImage.src = productImage.dataset.fallback;
  }, { once: true });

  document.querySelector("#addDetailToBag").addEventListener("click", () => {
    const quantityInput = document.querySelector("#productQuantity");
    const quantity = Number(quantityInput.value);
    const feedback = document.querySelector("#productDetailFeedback");
    if (stock === null) {
      feedback.textContent = "Stock is not set for this product. Please contact the store.";
      return;
    }
    if (stock === 0) {
      feedback.textContent = "This product is currently out of stock.";
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      feedback.textContent = "Choose a quantity between 1 and 99.";
      return;
    }
    if (quantity > stock) {
      feedback.textContent = `Only ${stock} ${stock === 1 ? "unit is" : "units are"} available.`;
      return;
    }

    let bag;
    try {
      bag = JSON.parse(sessionStorage.getItem("boluwatife-gadget-cart") || "[]");
      if (!Array.isArray(bag)) bag = [];
    } catch (error) {
      console.error("Could not read the shopping bag:", error);
      feedback.textContent = "Your shopping bag could not be read in this browser tab.";
      return;
    }
    const alreadyInBag = bag.filter(item => item.id === product.id).length;
    if (alreadyInBag + quantity > stock) {
      feedback.textContent = `Your bag already has ${alreadyInBag} ${alreadyInBag === 1 ? "unit" : "units"} of this product.`;
      return;
    }
    if (bag.length + quantity > 99) {
      feedback.textContent = "Your shopping bag can contain up to 99 items at a time.";
      return;
    }

    const bagProduct = { ...product, price: currency.format(Number(product.price)) };
    for (let count = 0; count < quantity; count += 1) bag.push(bagProduct);
    try {
      sessionStorage.setItem("boluwatife-gadget-cart", JSON.stringify(bag));
    } catch (error) {
      console.error("Could not save the shopping bag:", error);
      feedback.textContent = "Your shopping bag could not be saved in this browser tab.";
      return;
    }
    document.querySelector(".cart-count").textContent = bag.length;
    feedback.textContent = `${quantity} ${quantity === 1 ? "item" : "items"} added to your bag.`;
  });
}

async function loadProduct() {
  const productId = new URLSearchParams(window.location.search).get("id");
  if (!productId) {
    showDetailError("Choose a product from the catalog to see its details.");
    return;
  }
  try {
    const response = await fetch("/api/products");
    const products = await response.json();
    if (!response.ok) throw new Error(products.error || "Products could not be loaded.");
    const product = products.find(item => item.id === productId);
    if (!product) {
      showDetailError("This product could not be found. It may have been removed from the store.");
      return;
    }
    renderProduct(product);
  } catch (error) {
    console.error("Could not load product details:", error);
    showDetailError(error.message);
  }
}

try {
  const bag = JSON.parse(sessionStorage.getItem("boluwatife-gadget-cart") || "[]");
  document.querySelector(".cart-count").textContent = Array.isArray(bag) ? bag.length : "0";
} catch (error) {
  console.error("Could not load the shopping bag count:", error);
}

loadProduct();
