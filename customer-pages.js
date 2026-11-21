const accountView = document.querySelector("[data-account-view]");
const pageStatus = document.querySelector("#pageStatus");
const formatPrice = value => new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
}).format(Number(value));

async function loadAccountPage() {
  const sessionResponse = await fetch("/api/auth/session");
  const sessionResult = await sessionResponse.json();
  if (!sessionResponse.ok) throw new Error(sessionResult.error || "Your account could not be loaded.");
  if (!sessionResult.user || sessionResult.user.role !== "customer") {
    window.location.replace("account.html");
    return;
  }

  const user = sessionResult.user;
  const view = accountView.dataset.accountView;
  if (view === "profile") {
    document.querySelector("#profileName").textContent = user.name;
    document.querySelector("#profileEmail").textContent = user.email;
    const photo = document.querySelector("#profilePhoto");
    const initial = document.querySelector("#profileInitial");
    if (user.avatarUrl) {
      photo.src = user.avatarUrl;
      photo.hidden = false;
      initial.hidden = true;
    } else {
      initial.textContent = user.name.charAt(0).toUpperCase();
    }
  } else if (view === "info") {
    document.querySelector("#infoName").textContent = user.name;
    document.querySelector("#infoEmail").textContent = user.email;
    document.querySelector("#infoPhone").textContent = user.phone || "Not provided";
    document.querySelector("#infoAddress").textContent = user.address || "Not provided";
  } else if (view === "orders") {
    const response = await fetch("/api/orders");
    const orders = await response.json();
    if (!response.ok) throw new Error(orders.error || "Your orders could not be loaded.");
    renderOrders(orders);
  }

  accountView.hidden = false;
  pageStatus.hidden = true;
}

function renderOrders(orders) {
  const orderList = document.querySelector("#orderList");
  if (!orders.length) {
    const empty = document.createElement("p");
    empty.className = "order-empty";
    empty.textContent = "You do not have any orders yet.";
    orderList.append(empty);
    return;
  }

  orders.forEach(order => {
    const card = document.createElement("article");
    card.className = "order-card";
    const title = document.createElement("h2");
    title.textContent = `Order ${order.id}`;
    const detail = document.createElement("p");
    const date = new Date(order.createdAt);
    const amountDetails = order.deliveryFee === undefined
      ? formatPrice(order.total)
      : `Items ${formatPrice(order.subtotal)} · Delivery ${formatPrice(order.deliveryFee)} · Total ${formatPrice(order.total)}`;
    detail.textContent = `${date.toLocaleDateString()} · ${order.status.replace(/_/g, " ")} · ${order.paymentStatus || "Awaiting payment"} · ${amountDetails}`;
    card.append(title, detail);
    if (Array.isArray(order.items)) {
      const items = document.createElement("ul");
      order.items.forEach(item => {
        const row = document.createElement("li");
        row.textContent = `${item.name} × ${item.quantity}`;
        items.append(row);
      });
      card.append(items);
    }
    if (order.status === "pending_payment" && order.paymentDetails) {
      const transferDetails = document.createElement("div");
      transferDetails.className = "order-transfer-details";
      const heading = document.createElement("strong");
      heading.textContent = "Bank transfer details";
      transferDetails.append(heading);
      [
        ["Bank", order.paymentDetails.bankName],
        ["Account name", order.paymentDetails.accountName],
        ["Account number", order.paymentDetails.accountNumber]
      ].forEach(([label, value]) => {
        const row = document.createElement("p");
        row.textContent = `${label}: ${value}`;
        transferDetails.append(row);
      });
      const paidButton = document.createElement("button");
      paidButton.type = "button";
      paidButton.className = "button button-primary order-paid-button";
      paidButton.textContent = "I have paid";
      paidButton.addEventListener("click", async () => {
        paidButton.disabled = true;
        try {
          const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/payment-reported`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}"
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Your payment could not be reported.");
          order.status = result.order.status;
          order.paymentStatus = result.order.paymentStatus;
          orderList.replaceChildren();
          renderOrders(orders);
        } catch (error) {
          paidButton.disabled = false;
          const errorMessage = document.createElement("p");
          errorMessage.className = "order-payment-error";
          errorMessage.textContent = error.message;
          transferDetails.append(errorMessage);
        }
      });
      transferDetails.append(paidButton);
      card.append(transferDetails);
    } else if (order.status === "payment_reported") {
      const pending = document.createElement("p");
      pending.className = "order-payment-pending";
      pending.textContent = "Payment reported. Waiting for admin verification.";
      card.append(pending);
    }
    orderList.append(card);
  });
}

loadAccountPage().catch(error => {
  console.error("Could not load customer account page:", error);
  pageStatus.textContent = error.message;
  pageStatus.classList.add("error");
});
