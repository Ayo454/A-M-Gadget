const adminStatus = document.querySelector("#adminStatus");
const adminLoginPanel = document.querySelector("#adminLoginPanel");
const adminLoginForm = document.querySelector("#adminLoginForm");
const adminUserBar = document.querySelector("#adminUserBar");
const productManager = document.querySelector("#productManager");
const productFormPanel = document.querySelector("#productFormPanel");
const productForm = document.querySelector("#productForm");
const productRows = document.querySelector("#adminProductRows");
const productSearch = document.querySelector("#productSearch");
const categoryFilter = document.querySelector("#categoryFilter");
const stockFilter = document.querySelector("#stockFilter");
const pageSizeSelect = document.querySelector("#pageSize");
const userRows = document.querySelector("#adminUserRows");
const orderRows = document.querySelector("#adminOrderRows");
const riderRows = document.querySelector("#adminRiderRows");
const payoutRows = document.querySelector("#adminPayoutRows");
const userSearch = document.querySelector("#userSearch");
const orderSearch = document.querySelector("#orderSearch");
const orderDetailBackdrop = document.querySelector("#adminOrderDetailBackdrop");
const orderDetailContent = document.querySelector("#adminOrderDetailContent");
const orderDetailActions = document.querySelector("#adminOrderDetailActions");
const orderDetailMessage = document.querySelector("#adminOrderDetailMessage");

let products = [];
let users = [];
let orders = [];
let riders = [];
let payoutRequests = [];
let selectedProductId = null;
let selectedOrderId = null;
let editingProductId = null;
let currentPage = 1;
let pageSize = Number(pageSizeSelect.value);

async function adminRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const result = await response.json();
  if (!response.ok) {
    const message = result.error || "The request could not be completed.";
    if (response.status === 403) {
      products = [];
      users = [];
      orders = [];
      riders = [];
      payoutRequests = [];
      productRows.replaceChildren();
      userRows.replaceChildren();
      orderRows.replaceChildren();
      riderRows.replaceChildren();
      payoutRows.replaceChildren();
      productManager.hidden = true;
      adminUserBar.hidden = true;
      adminLoginPanel.hidden = false;
      orderDetailBackdrop.hidden = true;
      showAdminStatus(`${message} Sign in again to continue.`, true);
    }
    throw new Error(message);
  }
  return result;
}

function showAdminStatus(message, isError = false) {
  adminStatus.textContent = message;
  adminStatus.hidden = !message;
  adminStatus.classList.toggle("is-error", isError);
}

function formatPrice(value) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value));
}

function setAdminView(view) {
  document.querySelectorAll("[data-admin-panel]").forEach(panel => {
    panel.hidden = panel.dataset.adminPanel !== view;
  });
  document.querySelectorAll(".admin-side-nav [data-admin-view]").forEach(button => {
    const active = button.dataset.adminView === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  const titles = { overview: "Dashboard", products: "Products", users: "Users", orders: "Orders", riders: "Riders", payouts: "Payouts" };
  document.querySelector("#adminPageTitle").textContent = titles[view] || "Dashboard";
}

function getFilteredProducts() {
  const search = productSearch.value.trim().toLowerCase();
  const category = categoryFilter.value;
  const stock = stockFilter.value;
  return products.filter(product => {
    const matchesSearch = !search ||
      `${product.name} ${product.category} ${product.description || ""}`.toLowerCase().includes(search);
    const matchesCategory = !category || product.category === category;
    const quantity = Number(product.stock);
    const matchesStock = !stock ||
      (stock === "out" && quantity === 0) ||
      (stock === "low" && quantity > 0 && quantity <= 5) ||
      (stock === "in" && quantity > 5);
    return matchesSearch && matchesCategory && matchesStock;
  });
}

function renderProductRows() {
  const filtered = getFilteredProducts();
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  currentPage = Math.min(currentPage, pageCount);
  const start = (currentPage - 1) * pageSize;
  const pageProducts = filtered.slice(start, start + pageSize);
  productRows.replaceChildren();

  if (!pageProducts.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "admin-empty-row";
    cell.textContent = products.length ? "No products match these filters." : "Your catalog is empty. Add your first product.";
    row.append(cell);
    productRows.append(row);
  }

  pageProducts.forEach(product => {
    const row = document.createElement("tr");
    const productCell = document.createElement("td");
    const productInfo = document.createElement("div");
    const image = document.createElement("img");
    const nameAndDescription = document.createElement("div");
    const name = document.createElement("strong");
    const description = document.createElement("small");
    const badge = document.createElement("span");
    const categoryCell = document.createElement("td");
    const priceCell = document.createElement("td");
    const stockCell = document.createElement("td");
    const stockStatus = document.createElement("span");
    const statusCell = document.createElement("td");
    const actionCell = document.createElement("td");
    const viewButton = document.createElement("button");

    productInfo.className = "admin-table-product";
    image.className = "admin-product-thumb";
    image.src = product.image || `/images/products/${product.type}.jpg`;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => {
      image.src = `/images/products/${product.type}.jpg`;
    }, { once: true });
    nameAndDescription.className = "admin-product-name";
    name.textContent = product.name;
    description.textContent = product.description || "No description provided.";
    nameAndDescription.append(name, description);
    if (product.badge) {
      badge.className = "admin-catalog-badge";
      badge.textContent = product.badge;
      nameAndDescription.append(badge);
    }
    productInfo.append(image, nameAndDescription);
    productCell.append(productInfo);
    categoryCell.textContent = product.category;
    priceCell.textContent = formatPrice(product.price);

    const quantity = Number(product.stock);
    stockCell.textContent = Number.isInteger(quantity) ? String(quantity) : "—";
    stockStatus.className = `admin-stock-badge ${quantity === 0 ? "out" : quantity <= 5 ? "low" : "in"}`;
    stockStatus.textContent = quantity === 0 ? "Out of stock" : quantity <= 5 ? "Low stock" : "In stock";
    statusCell.append(stockStatus);

    viewButton.className = "admin-view-product";
    viewButton.type = "button";
    viewButton.dataset.productId = product.id;
    viewButton.textContent = "View details";
    viewButton.setAttribute("aria-label", `View details for ${product.name}`);
    actionCell.append(viewButton);

    row.append(productCell, categoryCell, priceCell, stockCell, statusCell, actionCell);
    productRows.append(row);
  });

  const firstItem = filtered.length ? start + 1 : 0;
  const lastItem = Math.min(start + pageSize, filtered.length);
  document.querySelector("#productCountLabel").textContent = `${filtered.length} product${filtered.length === 1 ? "" : "s"} found`;
  document.querySelector("#paginationSummary").textContent =
    filtered.length ? `Showing ${firstItem}–${lastItem} of ${filtered.length}` : "Showing 0 products";
  document.querySelector("#pageNumber").textContent = `${currentPage} / ${pageCount}`;
  document.querySelector("#previousPage").disabled = currentPage <= 1;
  document.querySelector("#nextPage").disabled = currentPage >= pageCount;
}

function renderCategoryOptions() {
  const selected = categoryFilter.value;
  const categories = [...new Set(products.map(product => product.category))].sort((a, b) => a.localeCompare(b));
  categoryFilter.replaceChildren(new Option("All categories", ""));
  categories.forEach(category => categoryFilter.add(new Option(category, category)));
  if (categories.includes(selected)) categoryFilter.value = selected;
}

function renderDashboard() {
  const stockTotal = products.reduce((sum, product) => sum + (Number.isInteger(Number(product.stock)) ? Number(product.stock) : 0), 0);
  const lowStock = products.filter(product => Number(product.stock) > 0 && Number(product.stock) <= 5).length;
  const categories = new Set(products.map(product => product.category));
  document.querySelector("#totalProductCount").textContent = products.length.toLocaleString();
  document.querySelector("#totalUserCount").textContent = users.length.toLocaleString();
  document.querySelector("#totalOrderCount").textContent = orders.length.toLocaleString();
  document.querySelector("#totalStockCount").textContent = stockTotal.toLocaleString();
  document.querySelector("#lowStockCount").textContent = lowStock.toLocaleString();
  document.querySelector("#categoryCount").textContent = categories.size.toLocaleString();
  document.querySelector("#adminUserCount").textContent = users.length.toLocaleString();
  document.querySelector("#adminOrderCount").textContent = orders.length.toLocaleString();
  document.querySelector("#adminRiderCount").textContent = riders.filter(rider => rider.status === "pending").length.toLocaleString();
  document.querySelector("#adminPayoutCount").textContent = payoutRequests.filter(payout => payout.status === "pending").length.toLocaleString();

  const recentProductList = document.querySelector("#recentProductList");
  recentProductList.replaceChildren();
  products.slice(0, 5).forEach(product => {
    const item = document.createElement("div");
    const name = document.createElement("strong");
    const details = document.createElement("span");
    const stock = document.createElement("span");
    item.className = "admin-recent-item";
    name.textContent = product.name;
    details.textContent = `${product.category} · ${formatPrice(product.price)}`;
    stock.className = `admin-stock-badge ${Number(product.stock) === 0 ? "out" : Number(product.stock) <= 5 ? "low" : "in"}`;
    stock.textContent = `${Number(product.stock) || 0} in stock`;
    item.append(name, details, stock);
    recentProductList.append(item);
  });
}

function createTableCell(value, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = value || "—";
  return cell;
}

function createEmptyRow(container, columnCount, message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = columnCount;
  cell.className = "admin-empty-row";
  cell.textContent = message;
  row.append(cell);
  container.append(row);
}

function renderUsers() {
  const search = userSearch.value.trim().toLowerCase();
  const filtered = users.filter(user =>
    `${user.name} ${user.email} ${user.phone} ${user.address}`.toLowerCase().includes(search)
  );
  userRows.replaceChildren();
  if (!filtered.length) {
    createEmptyRow(userRows, 4, users.length ? "No users match your search." : "No customer accounts have registered yet.");
  }
  filtered.forEach(user => {
    const row = document.createElement("tr");
    const personCell = document.createElement("td");
    const person = document.createElement("div");
    const name = document.createElement("strong");
    const email = document.createElement("small");
    const profileCell = document.createElement("td");
    const profile = document.createElement("span");
    person.className = "admin-record-person";
    name.textContent = user.name || "Unnamed customer";
    email.textContent = user.email || "No email";
    person.append(name, email);
    personCell.append(person);
    profile.className = `admin-record-tag ${user.hasAvatar ? "available" : ""}`;
    profile.textContent = user.hasAvatar ? "Uploaded" : "Not provided";
    profileCell.append(profile);
    row.append(
      personCell,
      createTableCell(user.phone, "admin-nowrap"),
      createTableCell(user.address, "admin-address-cell"),
      profileCell
    );
    userRows.append(row);
  });
  document.querySelector("#userCountLabel").textContent =
    `${filtered.length} user${filtered.length === 1 ? "" : "s"}${search ? " found" : ""}`;
}

function makeAdminActionButton(action, id, label, style = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `admin-secondary-button ${style}`.trim();
  button.dataset.adminAction = action;
  button.dataset.recordId = id;
  button.textContent = label;
  return button;
}

function renderRiders() {
  riderRows.replaceChildren();
  if (!riders.length) createEmptyRow(riderRows, 7, "No rider applications have been submitted yet.");
  riders.forEach(rider => {
    const row = document.createElement("tr");
    const person = document.createElement("div");
    const name = document.createElement("strong");
    const email = document.createElement("small");
    const vehicle = document.createElement("div");
    const vehicleName = document.createElement("strong");
    const phone = document.createElement("small");
    const bank = document.createElement("div");
    const bankName = document.createElement("strong");
    const accountDetails = document.createElement("small");
    const status = document.createElement("span");
    const actions = document.createElement("div");
    const personCell = document.createElement("td");
    const vehicleCell = document.createElement("td");
    const bankCell = document.createElement("td");
    const statusCell = document.createElement("td");
    const actionsCell = document.createElement("td");

    person.className = "admin-record-person";
    name.textContent = rider.name || "Unnamed applicant";
    email.textContent = rider.email || "No email";
    person.append(name, email);
    personCell.append(person);

    vehicle.className = "admin-record-person";
    vehicleName.textContent = rider.vehicleType || "Vehicle not provided";
    phone.textContent = rider.phone || "No phone";
    vehicle.append(vehicleName, phone);
    vehicleCell.append(vehicle);

    bank.className = "admin-record-person";
    bankName.textContent = rider.bankName || "No bank";
    accountDetails.textContent = `${rider.accountName || "No account name"} · ${rider.accountNumber || "No account number"}`;
    bank.append(bankName, accountDetails);
    bankCell.append(bank);

    status.className = `admin-record-tag ${rider.status === "active" ? "available" : ""}`;
    status.textContent = rider.status || "pending";
    statusCell.append(status);
    actions.className = "admin-record-actions";
    if (rider.status === "pending") {
      actions.append(
        makeAdminActionButton("approve-rider", rider.id, "Approve", "admin-approve-button"),
        makeAdminActionButton("reject-rider", rider.id, "Reject", "admin-reject-button")
      );
    } else {
      actions.textContent = "—";
    }
    actionsCell.append(actions);
    row.append(
      personCell,
      vehicleCell,
      createTableCell(rider.licensePlate || "—"),
      bankCell,
      statusCell,
      createTableCell(formatOrderDate(rider.createdAt), "admin-nowrap"),
      actionsCell
    );
    riderRows.append(row);
  });
  const pending = riders.filter(rider => rider.status === "pending").length;
  document.querySelector("#riderCountLabel").textContent =
    `${riders.length} rider${riders.length === 1 ? "" : "s"} · ${pending} awaiting review`;
}

function renderPayoutRequests() {
  payoutRows.replaceChildren();
  if (!payoutRequests.length) createEmptyRow(payoutRows, 7, "No weekly payout requests have been submitted.");
  payoutRequests.forEach(payout => {
    const row = document.createElement("tr");
    const rider = document.createElement("div");
    const name = document.createElement("strong");
    const email = document.createElement("small");
    const bank = document.createElement("div");
    const bankName = document.createElement("strong");
    const accountDetails = document.createElement("small");
    const status = document.createElement("span");
    const actions = document.createElement("div");
    const riderCell = document.createElement("td");
    const bankCell = document.createElement("td");
    const statusCell = document.createElement("td");
    const actionsCell = document.createElement("td");

    rider.className = "admin-record-person";
    name.textContent = payout.riderName || "Rider";
    email.textContent = payout.riderEmail || "No email";
    rider.append(name, email);
    riderCell.append(rider);

    bank.className = "admin-record-person";
    bankName.textContent = payout.bankName || "No bank";
    accountDetails.textContent = `${payout.accountName || "No account name"} · ${payout.accountNumber || "No account number"}`;
    bank.append(bankName, accountDetails);
    bankCell.append(bank);

    status.className = `admin-record-tag ${payout.status === "paid" ? "available" : ""}`;
    status.textContent = payout.status || "pending";
    statusCell.append(status);
    actions.className = "admin-record-actions";
    if (payout.status === "pending") {
      actions.append(
        makeAdminActionButton("mark-payout-paid", payout.id, "Mark paid", "admin-approve-button"),
        makeAdminActionButton("reject-payout", payout.id, "Reject", "admin-reject-button")
      );
    } else {
      actions.textContent = "—";
    }
    actionsCell.append(actions);
    row.append(
      riderCell,
      createTableCell(payout.weekKey, "admin-nowrap"),
      createTableCell(formatPrice(payout.amount), "admin-nowrap"),
      bankCell,
      statusCell,
      createTableCell(formatOrderDate(payout.createdAt), "admin-nowrap"),
      actionsCell
    );
    payoutRows.append(row);
  });
  const pending = payoutRequests.filter(payout => payout.status === "pending").length;
  document.querySelector("#payoutCountLabel").textContent =
    `${payoutRequests.length} request${payoutRequests.length === 1 ? "" : "s"} · ${pending} awaiting payment`;
}

function formatOrderDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function renderOrders() {
  const search = orderSearch.value.trim().toLowerCase();
  const filtered = orders.filter(order => {
    const itemNames = Array.isArray(order.items) ? order.items.map(item => item.name).join(" ") : "";
    return `${order.id} ${order.customerName} ${order.customerEmail} ${itemNames}`.toLowerCase().includes(search);
  });
  orderRows.replaceChildren();
  if (!filtered.length) {
    createEmptyRow(orderRows, 8, orders.length ? "No orders match your search." : "No customer orders have been placed yet.");
  }
  filtered.forEach(order => {
    const row = document.createElement("tr");
    const orderId = document.createElement("strong");
    const orderCell = document.createElement("td");
    const customerCell = document.createElement("td");
    const customer = document.createElement("div");
    const customerName = document.createElement("strong");
    const customerEmail = document.createElement("small");
    const customerPhone = document.createElement("small");
    const customerAddress = document.createElement("small");
    const items = document.createElement("span");
    const orderStatus = document.createElement("span");
    const paymentStatus = document.createElement("span");
    orderId.className = "admin-order-id";
    orderId.textContent = String(order.id || "Order").slice(0, 8).toUpperCase();
    orderCell.append(orderId);
    customer.className = "admin-record-person admin-order-customer";
    customerName.textContent = order.customerName || "Customer account unavailable";
    customerEmail.textContent = order.customerEmail || "No email";
    customerPhone.textContent = order.customerPhone || "No phone";
    customerAddress.textContent = order.shippingAddress || "No delivery address";
    customer.append(customerName, customerEmail, customerPhone, customerAddress);
    customerCell.append(customer);
    items.className = "admin-order-items";
    items.textContent = Array.isArray(order.items)
      ? order.items.map(item => `${item.name} × ${item.quantity}`).join(", ") || "—"
      : "—";
    orderStatus.className = "admin-record-tag available";
    orderStatus.textContent = order.status || "Received";
    paymentStatus.className = "admin-record-tag";
    paymentStatus.textContent = order.paymentStatus || "Not processed";
    const totalCell = createTableCell(formatPrice(order.total), "admin-nowrap");
    if (order.deliveryFee) {
      const deliveryFee = document.createElement("small");
      deliveryFee.textContent = `Includes ${formatPrice(order.deliveryFee)} delivery`;
      totalCell.append(deliveryFee);
    }
    row.append(
      orderCell,
      customerCell,
      createTableCell(formatOrderDate(order.createdAt), "admin-nowrap"),
      createTableCell(items.textContent, "admin-order-items-cell"),
      totalCell,
      createTableCell(order.status || "Received"),
      createTableCell(order.paymentStatus || "Awaiting payment")
    );
    const detailsCell = document.createElement("td");
    const detailsButton = document.createElement("button");
    detailsButton.type = "button";
    detailsButton.className = "admin-secondary-button admin-view-order-button";
    detailsButton.dataset.orderId = order.id;
    detailsButton.textContent = "Details";
    detailsCell.append(detailsButton);
    row.append(detailsCell);
    row.children[1].replaceChildren(customer);
    row.children[3].replaceChildren(items);
    row.children[5].replaceChildren(orderStatus);
    row.children[6].replaceChildren(paymentStatus);
    orderRows.append(row);
  });
  document.querySelector("#orderCountLabel").textContent =
    `${filtered.length} order${filtered.length === 1 ? "" : "s"}${search ? " found" : ""}`;
}

function formatOrderStatus(status) {
  const labels = {
    pending_payment: "Pending payment",
    payment_reported: "Payment reported",
    confirmed: "Payment confirmed",
    shipping: "Assigned to rider",
    in_transit: "In transit",
    delivered: "Delivered",
    cancelled: "Cancelled"
  };
  return labels[status] || status || "Pending payment";
}

function renderOrderDetail(order) {
  selectedOrderId = order.id;
  document.querySelector("#adminOrderDetailTitle").textContent = `Order ${String(order.id).slice(0, 8).toUpperCase()}`;
  document.querySelector("#adminOrderDetailStatus").textContent =
    `${formatOrderStatus(order.status)} · ${order.paymentStatus || "Awaiting payment"}`;
  orderDetailContent.replaceChildren();
  orderDetailActions.replaceChildren();
  orderDetailMessage.hidden = true;

  const customer = document.createElement("div");
  customer.className = "admin-order-customer-details";
  [
    order.customerName || "Customer",
    order.customerEmail || "No email",
    order.customerPhone || "No phone",
    order.shippingAddress || "No delivery address"
  ].forEach(value => {
    const line = document.createElement("span");
    line.textContent = value;
    customer.append(line);
  });
  if (order.riderName) {
    const assignment = document.createElement("span");
    const label = order.status === "delivered" ? "Delivered by" : "Assigned rider";
    assignment.textContent = `${label}: ${order.riderName}${order.riderEmail ? ` (${order.riderEmail})` : ""}`;
    customer.append(assignment);
  }
  orderDetailContent.append(customer);

  const itemList = document.createElement("div");
  itemList.className = "admin-order-detail-items";
  (Array.isArray(order.items) ? order.items : []).forEach(item => {
    const row = document.createElement("div");
    row.className = "admin-order-detail-item";
    const image = document.createElement("img");
    const productDetails = document.createElement("div");
    const name = document.createElement("strong");
    const unitPrice = document.createElement("small");
    const lineTotal = document.createElement("b");
    image.src = item.image || "/images/products/phone.jpg";
    image.alt = item.name || "";
    image.loading = "lazy";
    image.addEventListener("error", () => { image.src = "/images/products/phone.jpg"; }, { once: true });
    name.textContent = item.name || "Product";
    unitPrice.textContent = `${formatPrice(item.price)} × ${item.quantity}`;
    lineTotal.textContent = formatPrice(Number(item.price) * Number(item.quantity));
    productDetails.append(name, unitPrice);
    row.append(image, productDetails, lineTotal);
    itemList.append(row);
  });
  orderDetailContent.append(itemList);

  const totals = document.createElement("div");
  totals.className = "admin-order-detail-totals";
  [
    ["Subtotal", order.subtotal ?? order.total],
    ["Delivery", order.deliveryFee ?? 0],
    ["Total", order.total]
  ].forEach(([label, amount], index) => {
    const row = document.createElement("div");
    if (index === 2) row.className = "grand-total";
    const title = document.createElement("span");
    const value = document.createElement("strong");
    title.textContent = label;
    value.textContent = formatPrice(amount);
    row.append(title, value);
    totals.append(row);
  });
  orderDetailContent.append(totals);

  const actions = [];
  if (order.status === "payment_reported") actions.push(["confirm_payment", "Confirm payment", "primary"]);
  if (order.status === "confirmed") {
    const activeRiders = riders.filter(rider => rider.status === "active");
    const riderSelect = document.createElement("select");
    riderSelect.id = "orderRiderSelect";
    riderSelect.setAttribute("aria-label", "Select an approved rider");
    riderSelect.append(new Option(activeRiders.length ? "Select an approved rider" : "No approved riders", ""));
    activeRiders.forEach(rider => riderSelect.add(new Option(`${rider.name} · ${rider.phone}`, rider.id)));
    orderDetailActions.append(riderSelect);
    actions.push(["mark_shipping", "Assign & prepare shipment", "primary"]);
  }
  if (["pending_payment", "payment_reported", "confirmed", "shipping", "in_transit"].includes(order.status)) {
    actions.push(["cancel", "Cancel order", "danger"]);
  }
  actions.forEach(([action, label, style]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `admin-order-action ${style}`;
    button.textContent = label;
    if (action === "mark_shipping" && riders.every(rider => rider.status !== "active")) button.disabled = true;
    button.addEventListener("click", () => {
      const riderSelect = document.querySelector("#orderRiderSelect");
      if (action === "mark_shipping" && (!riderSelect || !riderSelect.value)) {
        orderDetailMessage.textContent = "Select an approved rider before assigning this delivery.";
        orderDetailMessage.hidden = false;
        return;
      }
      updateOrderAction(order.id, action, button, action === "mark_shipping" ? { riderId: riderSelect.value } : {});
    });
    orderDetailActions.append(button);
  });

  if (order.status === "pending_payment") {
    orderDetailMessage.textContent = "Waiting for the customer to report their bank transfer.";
    orderDetailMessage.hidden = false;
  } else if (order.status === "payment_reported") {
    orderDetailMessage.textContent = "Verify the transfer in your bank before confirming payment.";
    orderDetailMessage.hidden = false;
  } else if (order.status === "shipping") {
    orderDetailMessage.textContent = "The assigned rider can now start this delivery from their dashboard.";
    orderDetailMessage.hidden = false;
  } else if (order.status === "in_transit") {
    orderDetailMessage.textContent = "The rider must verify the customer's code before this order can be marked delivered.";
    orderDetailMessage.hidden = false;
  }
  orderDetailBackdrop.hidden = false;
}

async function updateOrderAction(orderId, action, button, details = {}) {
  button.disabled = true;
  orderDetailMessage.hidden = false;
  orderDetailMessage.textContent = "Updating order...";
  try {
    const result = await adminRequest(`/api/admin/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      body: JSON.stringify({ action, ...details })
    });
    const orderIndex = orders.findIndex(order => order.id === orderId);
    if (orderIndex !== -1) orders[orderIndex] = { ...orders[orderIndex], ...result.order };
    renderOrders();
    const updatedOrder = orders.find(order => order.id === orderId);
    if (updatedOrder) {
      renderOrderDetail(updatedOrder);
      orderDetailMessage.textContent = "Order status updated.";
      orderDetailMessage.hidden = false;
    }
  } catch (error) {
    orderDetailMessage.textContent = error.message;
    orderDetailMessage.hidden = false;
    button.disabled = false;
  }
}

orderRows.addEventListener("click", event => {
  const button = event.target.closest("[data-order-id]");
  if (!button) return;
  const order = orders.find(item => item.id === button.dataset.orderId);
  if (order) renderOrderDetail(order);
});
document.querySelector("#closeOrderDetail").addEventListener("click", () => {
  orderDetailBackdrop.hidden = true;
  selectedOrderId = null;
});
orderDetailBackdrop.addEventListener("click", event => {
  if (event.target === orderDetailBackdrop) {
    orderDetailBackdrop.hidden = true;
    selectedOrderId = null;
  }
});

async function loadAdminData() {
  [products, users, orders, riders, payoutRequests] = await Promise.all([
    adminRequest("/api/products"),
    adminRequest("/api/admin/users"),
    adminRequest("/api/admin/orders"),
    adminRequest("/api/admin/riders"),
    adminRequest("/api/admin/payout-requests")
  ]);
  renderCategoryOptions();
  renderDashboard();
  renderProductRows();
  renderUsers();
  renderOrders();
  renderRiders();
  renderPayoutRequests();
}

async function updateAdminRecord(button) {
  const action = button.dataset.adminAction;
  const id = button.dataset.recordId;
  const isRiderAction = action === "approve-rider" || action === "reject-rider";
  const endpoint = isRiderAction
    ? `/api/admin/riders/${encodeURIComponent(id)}`
    : `/api/admin/payout-requests/${encodeURIComponent(id)}`;
  const bodyAction = action === "approve-rider" ? "approve"
    : action === "reject-rider" || action === "reject-payout" ? "reject"
    : "mark_paid";
  const record = isRiderAction
    ? riders.find(rider => rider.id === id)
    : payoutRequests.find(payout => payout.id === id);
  if (action === "mark-payout-paid" && record &&
      !window.confirm(`Confirm that ₦${Number(record.amount).toLocaleString()} has been transferred to ${record.accountName || record.riderName}?`)) {
    return;
  }
  button.disabled = true;
  try {
    await adminRequest(endpoint, {
      method: "PATCH",
      body: JSON.stringify({ action: bodyAction })
    });
    await loadAdminData();
    const description = isRiderAction
      ? `Rider application ${bodyAction === "approve" ? "approved" : "rejected"}.`
      : `Payout request ${bodyAction === "mark_paid" ? "marked as paid" : "rejected"}.`;
    showAdminStatus(description);
  } catch (error) {
    showAdminStatus(error.message, true);
    button.disabled = false;
  }
}

function showProductManager() {
  adminLoginPanel.hidden = true;
  productManager.hidden = false;
  adminUserBar.hidden = false;
  setAdminView("overview");
  loadAdminData().catch(error => showAdminStatus(error.message, true));
}

function openProductForm(product = null) {
  editingProductId = product ? product.id : null;
  productForm.reset();
  if (product) {
    Object.entries(product).forEach(([name, value]) => {
      const field = productForm.elements.namedItem(name);
      if (field) field.value = value === null ? "" : value;
    });
  }
  document.querySelector("#productFormTitle").textContent = product ? "Edit product" : "Add a gadget";
  document.querySelector("#productFormDescription").textContent = product
    ? "Update the product information in your private catalog."
    : "New products will appear in the storefront catalog.";
  document.querySelector("#saveProductButton").innerHTML = product ? "Save changes <span>→</span>" : "Save product <span>→</span>";
  setAdminView("products");
  productFormPanel.hidden = false;
  document.querySelector("#productFormPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  productForm.querySelector("[name=name]").focus({ preventScroll: true });
}

function closeProductForm() {
  productFormPanel.hidden = true;
  editingProductId = null;
}

function renderProductDetails(product) {
  selectedProductId = product.id;
  const detailPanel = document.querySelector("#adminProductDetail");
  const content = document.querySelector("#adminProductDetailContent");
  const name = document.querySelector("#adminProductDetailName");
  const image = document.createElement("img");
  const facts = document.createElement("dl");
  const fallbackImage = `/images/products/${product.type}.jpg`;

  name.textContent = product.name;
  image.className = "admin-product-detail-image";
  image.src = product.image || fallbackImage;
  image.alt = product.name;
  image.addEventListener("error", () => { image.src = fallbackImage; }, { once: true });
  facts.className = "admin-product-detail-facts";
  [
    ["Category", product.category],
    ["Price", formatPrice(product.price)],
    ["Old price", product.oldPrice ? formatPrice(product.oldPrice) : "—"],
    ["Stock", String(product.stock)],
    ["Badge", product.badge || "—"],
    ["Product code", product.id]
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    item.append(term, description);
    facts.append(item);
  });
  const description = document.createElement("p");
  description.className = "admin-product-detail-description";
  description.textContent = product.description || "No description provided.";
  content.replaceChildren(image, facts, description);
  detailPanel.hidden = false;
  detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openProductDetails(productId) {
  const product = products.find(item => item.id === productId);
  if (product) renderProductDetails(product);
}

async function deleteSelectedProduct() {
  const product = products.find(item => item.id === selectedProductId);
  if (!product || !window.confirm(`Delete "${product.name}" from the catalog? This cannot be undone.`)) return;
  try {
    await adminRequest(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
    document.querySelector("#adminProductDetail").hidden = true;
    selectedProductId = null;
    await loadAdminData();
    showAdminStatus(`${product.name} was deleted from the catalog.`);
  } catch (error) {
    showAdminStatus(error.message, true);
  }
}

adminLoginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(adminLoginForm));
  try {
    await adminRequest("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(values)
    });
    showProductManager();
    showAdminStatus("Admin signed in.");
  } catch (error) {
    showAdminStatus(error.message, true);
  }
});

productForm.addEventListener("submit", async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(productForm));
  try {
    const isEditing = Boolean(editingProductId);
    const endpoint = isEditing
      ? `/api/admin/products/${encodeURIComponent(editingProductId)}`
      : "/api/admin/products";
    const product = await adminRequest(endpoint, {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(values)
    });
    await loadAdminData();
    closeProductForm();
    if (selectedProductId === product.id) openProductDetails(product.id);
    showAdminStatus(`${product.name} was ${isEditing ? "updated" : "added to"} the catalog.`);
  } catch (error) {
    showAdminStatus(error.message, true);
  }
});

document.querySelector("#adminLogout").addEventListener("click", async () => {
  try {
    await adminRequest("/api/auth/logout", { method: "POST", body: "{}" });
    productManager.hidden = true;
    adminUserBar.hidden = true;
    adminLoginPanel.hidden = false;
    adminLoginForm.reset();
    showAdminStatus("You have signed out.");
  } catch (error) {
    showAdminStatus(error.message, true);
  }
});

document.querySelectorAll("[data-admin-view]").forEach(button => {
  button.addEventListener("click", () => setAdminView(button.dataset.adminView));
});
riderRows.addEventListener("click", event => {
  const button = event.target.closest("[data-admin-action]");
  if (button) updateAdminRecord(button);
});
payoutRows.addEventListener("click", event => {
  const button = event.target.closest("[data-admin-action]");
  if (button) updateAdminRecord(button);
});
document.querySelectorAll("[data-open-product-form]").forEach(button => {
  button.addEventListener("click", openProductForm);
});
document.querySelector("#closeProductForm").addEventListener("click", closeProductForm);
document.querySelector("#cancelProductForm").addEventListener("click", closeProductForm);
document.querySelector("#closeProductDetail").addEventListener("click", () => {
  document.querySelector("#adminProductDetail").hidden = true;
  selectedProductId = null;
});
productRows.addEventListener("click", event => {
  const button = event.target.closest("[data-product-id]");
  if (button) openProductDetails(button.dataset.productId);
});
document.querySelector("#editProductButton").addEventListener("click", () => {
  const product = products.find(item => item.id === selectedProductId);
  if (product) openProductForm(product);
});
document.querySelector("#deleteProductButton").addEventListener("click", deleteSelectedProduct);

productSearch.addEventListener("input", () => {
  currentPage = 1;
  renderProductRows();
});
categoryFilter.addEventListener("change", () => {
  currentPage = 1;
  renderProductRows();
});
stockFilter.addEventListener("change", () => {
  currentPage = 1;
  renderProductRows();
});
pageSizeSelect.addEventListener("change", () => {
  pageSize = Number(pageSizeSelect.value);
  currentPage = 1;
  renderProductRows();
});
userSearch.addEventListener("input", renderUsers);
orderSearch.addEventListener("input", renderOrders);
document.querySelector("#previousPage").addEventListener("click", () => {
  currentPage -= 1;
  renderProductRows();
});
document.querySelector("#nextPage").addEventListener("click", () => {
  currentPage += 1;
  renderProductRows();
});

adminRequest("/api/auth/session")
  .then(result => {
    if (result.user && result.user.role === "admin") showProductManager();
    if (result.user && result.user.role === "customer") {
      showAdminStatus("This area is for the store admin. Sign out of your customer account first.", true);
    }
    if (result.user && result.user.role === "rider") {
      showAdminStatus("This area is for the store admin. Sign out of your rider account first.", true);
    }
  })
  .catch(error => showAdminStatus(error.message, true));
