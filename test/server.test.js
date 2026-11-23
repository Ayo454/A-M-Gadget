const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createServer } = require("../server");

async function createTestApp(t, serverOptions = {}) {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "a-and-m-gadget-"));
  let server = createServer({
    dataDirectory,
    adminEmail: "owner@example.com",
    adminPassword: "test-admin-password",
    brevoApiKey: "test-brevo-api-key",
    brevoSenderEmail: "store@example.com",
    brevoSenderName: "Test Gadget Store",
    brevoFetch: async () => ({ ok: true, status: 201 }),
    paymentBankName: "Test Bank",
    paymentAccountName: "Test Gadget Store",
    paymentAccountNumber: "0000000000",
    ...serverOptions
  });

  async function listen() {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    return `http://127.0.0.1:${server.address().port}`;
  }

  async function close() {
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  t.after(async () => {
    await close();
    await fs.rm(dataDirectory, { recursive: true, force: true });
  });

  return {
    dataDirectory,
    listen,
    close,
    restart() {
      server = createServer({
        dataDirectory,
        adminEmail: "owner@example.com",
        adminPassword: "test-admin-password",
        paymentBankName: "Test Bank",
        paymentAccountName: "Test Gadget Store",
        paymentAccountNumber: "0000000000",
        ...serverOptions
      });
    }
  };
}

function jsonRequest(url, method = "GET", body, cookie) {
  return fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function sessionCookie(response) {
  return response.headers.get("set-cookie").split(";")[0];
}

test("serves the store and keeps the data files private", async t => {
  const app = await createTestApp(t);
  const baseUrl = await app.listen();

  const home = await fetch(baseUrl);
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  assert.match(homeHtml, /A&amp;M Gadget/);
  assert.match(homeHtml, /site\.webmanifest/);
  assert.match(homeHtml, /data-install-app/);
  assert.match(homeHtml, /src="\/pwa\.js"/);
  assert.doesNotMatch(homeHtml, /Shop app|Customer care|Rider portal|Chat or call customer care/);
  assert.match(homeHtml, /class="cart-drawer" inert/);
  assert.doesNotMatch(homeHtml, /class="cart-drawer" aria-hidden=/);

  const accountPage = await fetch(`${baseUrl}/account.html`);
  assert.equal(accountPage.status, 200);
  const riderPage = await fetch(`${baseUrl}/rider.app.html`);
  assert.equal(riderPage.status, 200);
  const riderPageHtml = await riderPage.text();
  assert.match(riderPageHtml, /Rider portal/);
  assert.doesNotMatch(riderPageHtml, /href="(?:index|admin)(?:\.html|\/|#)/);
  assert.match(riderPageHtml, /mobile-web-app-capable/);
  assert.match(riderPageHtml, /data-app-loader/);
  const riderAppRoute = await fetch(`${baseUrl}/rider`);
  assert.equal(riderAppRoute.status, 200);
  assert.match(await riderAppRoute.text(), /data-install-app/);
  const oldRiderPage = await fetch(`${baseUrl}/rider.html`);
  assert.equal(oldRiderPage.status, 200);
  const shopAppRoute = await fetch(`${baseUrl}/app`);
  assert.equal(shopAppRoute.status, 200);
  const shopAppHtml = await shopAppRoute.text();
  assert.match(shopAppHtml, /app.webmanifest/);
  assert.match(shopAppHtml, /data-app-loader/);
  assert.match(shopAppHtml, /mobile-web-app-capable/);
  assert.match(shopAppHtml, /apple-mobile-web-app-capable/);
  const customerCarePage = await fetch(`${baseUrl}/customercare`);
  assert.equal(customerCarePage.status, 200);
  assert.match(await customerCarePage.text(), /Customer care inbox/);
  const oldCustomerCarePage = await fetch(`${baseUrl}/customer-care`, { redirect: "manual" });
  assert.equal(oldCustomerCarePage.status, 308);
  assert.equal(oldCustomerCarePage.headers.get("location"), "/customercare");
  for (const manifestPath of ["/site.webmanifest", "/app.webmanifest", "/customer-care.webmanifest", "/rider.webmanifest", "/admin.webmanifest"]) {
    const manifestResponse = await fetch(`${baseUrl}${manifestPath}`);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get("content-type"), /application\/manifest\+json/);
    const manifest = await manifestResponse.json();
    assert.equal(typeof manifest.start_url, "string");
    assert.equal(manifest.display, "standalone");
    if (manifestPath === "/site.webmanifest") assert.equal(manifest.start_url, "/");
    if (manifestPath === "/customer-care.webmanifest") assert.equal(manifest.start_url, "/customercare");
    if (manifestPath === "/admin.webmanifest") assert.equal(manifest.start_url, "/admin");
  }
  for (const iconPath of ["/app-icon-192.png", "/app-icon-512.png", "/rider-icon-192.png", "/rider-icon-512.png"]) {
    const icon = await fetch(`${baseUrl}${iconPath}`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get("content-type"), /image\/png/);
  }
  const announcementScript = await fetch(`${baseUrl}/announcement.js`);
  assert.equal(announcementScript.status, 200);
  const appLoaderStyles = await fetch(`${baseUrl}/app-loader.css`);
  assert.equal(appLoaderStyles.status, 200);
  assert.match(appLoaderStyles.headers.get("content-type"), /text\/css/);
  const adminPage = await fetch(`${baseUrl}/admin`);
  assert.equal(adminPage.status, 200);
  const adminPageHtml = await adminPage.text();
  assert.match(adminPageHtml, /admin\.webmanifest/);
  assert.match(adminPageHtml, /data-app-loader/);
  assert.match(adminPageHtml, /mobile-web-app-capable/);
  assert.match(adminPageHtml, /data-install-app/);
  assert.match(adminPageHtml, /src="pwa\.js"/);
  const oldAdminPage = await fetch(`${baseUrl}/admin.html`, { redirect: "manual" });
  assert.equal(oldAdminPage.status, 308);
  assert.equal(oldAdminPage.headers.get("location"), "/admin");
  const allProductsPage = await fetch(`${baseUrl}/view%20all.html`);
  assert.equal(allProductsPage.status, 200);
  const productDetailPage = await fetch(`${baseUrl}/product.html`);
  assert.equal(productDetailPage.status, 200);
  const customerNavigation = await fetch(`${baseUrl}/customer-nav.js`);
  assert.equal(customerNavigation.status, 200);
  assert.doesNotMatch(await customerNavigation.text(), /admin\.html/);
  const productImage = await fetch(`${baseUrl}/images/products/phone.jpg`);
  assert.equal(productImage.status, 200);
  assert.match(productImage.headers.get("content-type"), /image\/jpeg/);
  for (const page of ["profile.html", "account-info.html", "orders.html"]) {
    const response = await fetch(`${baseUrl}/${page}`);
    assert.equal(response.status, 200);
  }
  const productResponse = await fetch(`${baseUrl}/api/products`);
  const products = await productResponse.json();
  assert.equal(typeof products[0].description, "string");
  assert.equal(products[0].image, "/images/products/phone.jpg");
  const privateData = await fetch(`${baseUrl}/data/users.json`);
  assert.equal(privateData.status, 404);
  const serverSource = await fetch(`${baseUrl}/server.js`);
  assert.equal(serverSource.status, 404);
});

test("keeps customer support messages and audio-call signaling private to the customer and admin", async t => {
  const app = await createTestApp(t);
  const baseUrl = await app.listen();
  const registration = await jsonRequest(`${baseUrl}/api/auth/register`, "POST", {
    name: "Support Customer",
    email: "support@example.com",
    password: "customer-password",
    phone: "+234 801 234 5678",
    address: "12 Example Road, Ilishan-Remo"
  });
  assert.equal(registration.status, 201);
  const customerCookie = sessionCookie(registration);
  const adminLogin = await jsonRequest(`${baseUrl}/api/admin/login`, "POST", {
    email: "owner@example.com",
    password: "test-admin-password"
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = sessionCookie(adminLogin);

  const unauthorizedInbox = await jsonRequest(`${baseUrl}/api/admin/support`);
  assert.equal(unauthorizedInbox.status, 403);
  const firstMessage = await jsonRequest(`${baseUrl}/api/support/messages`, "POST", { text: "Can you help me?" }, customerCookie);
  assert.equal(firstMessage.status, 201);
  const inbox = await jsonRequest(`${baseUrl}/api/admin/support`, "GET", undefined, adminCookie);
  assert.equal(inbox.status, 200);
  const [threadSummary] = await inbox.json();
  assert.equal(threadSummary.lastMessage, "Can you help me?");

  const adminReply = await jsonRequest(`${baseUrl}/api/admin/support/messages`, "POST", {
    customerId: threadSummary.customerId,
    text: "Yes, how can we help?"
  }, adminCookie);
  assert.equal(adminReply.status, 201);
  const customerThread = await jsonRequest(`${baseUrl}/api/support`, "GET", undefined, customerCookie);
  assert.equal((await customerThread.json()).thread.messages.length, 2);

  const startedCall = await jsonRequest(`${baseUrl}/api/support/calls`, "POST", { action: "start" }, customerCookie);
  assert.equal(startedCall.status, 201);
  const call = (await startedCall.json()).call;
  const offer = await jsonRequest(`${baseUrl}/api/support/calls/${call.id}/signals`, "POST", {
    type: "offer",
    payload: "customer offer sdp"
  }, customerCookie);
  assert.equal(offer.status, 201);
  const careThread = await jsonRequest(
    `${baseUrl}/api/admin/support/${threadSummary.customerId}`,
    "GET",
    undefined,
    adminCookie
  );
  assert.equal((await careThread.json()).thread.call.signals[0].type, "offer");

  const adminAnswer = await jsonRequest(
    `${baseUrl}/api/support/calls/${call.id}/signals?customerId=${encodeURIComponent(threadSummary.customerId)}`,
    "POST",
    { type: "answer", payload: "admin answer sdp" },
    adminCookie
  );
  assert.equal(adminAnswer.status, 201);
  const answer = await jsonRequest(`${baseUrl}/api/support/calls/${call.id}/signals`, "GET", undefined, customerCookie);
  assert.equal((await answer.json()).call.status, "active");

  const endedCall = await jsonRequest(`${baseUrl}/api/support/calls`, "POST", {
    action: "end",
    callId: call.id,
    customerId: threadSummary.customerId
  }, adminCookie);
  assert.equal(endedCall.status, 200);
  const finalThread = await jsonRequest(`${baseUrl}/api/support`, "GET", undefined, customerCookie);
  assert.equal((await finalThread.json()).thread.call.status, "ended");

  const abandonedCallResponse = await jsonRequest(`${baseUrl}/api/support/calls`, "POST", { action: "start" }, customerCookie);
  const abandonedCall = (await abandonedCallResponse.json()).call;
  const supportPath = path.join(app.dataDirectory, "support.json");
  const supportRecords = JSON.parse(await fs.readFile(supportPath, "utf8"));
  supportRecords[0].call.startedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  await fs.writeFile(supportPath, JSON.stringify(supportRecords));
  const expiredCall = await jsonRequest(`${baseUrl}/api/support`, "GET", undefined, customerCookie);
  assert.equal((await expiredCall.json()).thread.call.status, "ended");

  const activeCallResponse = await jsonRequest(`${baseUrl}/api/support/calls`, "POST", { action: "start" }, customerCookie);
  const activeCall = (await activeCallResponse.json()).call;
  await jsonRequest(`${baseUrl}/api/support/calls/${activeCall.id}/signals`, "POST", {
    type: "offer",
    payload: "customer offer sdp"
  }, customerCookie);
  await jsonRequest(
    `${baseUrl}/api/support/calls/${activeCall.id}/signals?customerId=${encodeURIComponent(threadSummary.customerId)}`,
    "POST",
    { type: "answer", payload: "admin answer sdp" },
    adminCookie
  );
  const activeSupportRecords = JSON.parse(await fs.readFile(supportPath, "utf8"));
  activeSupportRecords[0].call.lastActivityAt = new Date(Date.now() - 60 * 1000).toISOString();
  await fs.writeFile(supportPath, JSON.stringify(activeSupportRecords));
  const staleHeartbeat = await jsonRequest(`${baseUrl}/api/support/calls`, "POST", {
    action: "heartbeat",
    callId: activeCall.id
  }, customerCookie);
  assert.equal(staleHeartbeat.status, 409);
  const expiredActiveCall = await jsonRequest(`${baseUrl}/api/support`, "GET", undefined, customerCookie);
  assert.equal((await expiredActiveCall.json()).thread.call.status, "ended");
});

test("registers customers and stores only salted password hashes", async t => {
  const app = await createTestApp(t, {
    openMapRequestInterval: 0,
    openMapFetch: async () => ({ ok: false, status: 503 })
  });
  const baseUrl = await app.listen();
  const registration = await jsonRequest(`${baseUrl}/api/auth/register`, "POST", {
    name: "Test Customer",
    email: "customer@example.com",
    password: "customer-password",
    phone: "+1 555 123 4567",
    address: "123 Example Street, Test City",
    avatar: {
      type: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S2cAAAAASUVORK5CYII="
    }
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.headers.get("set-cookie").includes("HttpOnly"), true);
  const registeredUser = (await registration.json()).user;
  assert.equal(registeredUser.role, "customer");
  assert.equal(registeredUser.phone, "+1 555 123 4567");
  assert.equal(registeredUser.address, "123 Example Street, Test City");
  assert.equal(registeredUser.avatarUrl, "/api/auth/avatar");
  const customerCookie = sessionCookie(registration);

  const storedUsers = JSON.parse(await fs.readFile(path.join(app.dataDirectory, "users.json"), "utf8"));
  assert.equal(storedUsers.length, 1);
  assert.notEqual(storedUsers[0].passwordHash, "customer-password");
  assert.equal("password" in storedUsers[0], false);
  assert.equal(storedUsers[0].phone, "+1 555 123 4567");
  assert.equal(storedUsers[0].address, "123 Example Street, Test City");
  assert.equal(await fs.readFile(path.join(app.dataDirectory, "uploads", storedUsers[0].avatarFile)).then(image => image.length > 0), true);
  const privateAvatar = await jsonRequest(`${baseUrl}/api/auth/avatar`);
  assert.equal(privateAvatar.status, 401);
  const customerAvatar = await jsonRequest(`${baseUrl}/api/auth/avatar`, "GET", undefined, customerCookie);
  assert.equal(customerAvatar.status, 200);
  assert.equal(customerAvatar.headers.get("content-type"), "image/png");
  const customerProduct = await jsonRequest(`${baseUrl}/api/admin/products`, "POST", {
    name: "Not Allowed",
    category: "Gadgets",
    price: 99,
    type: "phone"
  }, customerCookie);
  assert.equal(customerProduct.status, 403);
  const customerOrders = await jsonRequest(`${baseUrl}/api/orders`, "GET", undefined, customerCookie);
  assert.equal(customerOrders.status, 200);
  assert.deepEqual(await customerOrders.json(), []);
  const checkoutDetails = await jsonRequest(`${baseUrl}/api/checkout`, "GET", undefined, customerCookie);
  assert.equal(checkoutDetails.status, 200);
  const checkout = await checkoutDetails.json();
  assert.equal(checkout.user.email, "customer@example.com");
  assert.equal(checkout.user.phone, "+1 555 123 4567");
  const privateOrders = await jsonRequest(`${baseUrl}/api/orders`);
  assert.equal(privateOrders.status, 401);
  const privateCheckout = await jsonRequest(`${baseUrl}/api/checkout`);
  assert.equal(privateCheckout.status, 401);
  const unauthenticatedOrder = await jsonRequest(`${baseUrl}/api/orders`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 1 }]
  });
  assert.equal(unauthenticatedOrder.status, 401);
  const unauthenticatedQuote = await jsonRequest(`${baseUrl}/api/orders/quote`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 1 }],
    address: "123 Example Street, Abeokuta, Ogun State"
  });
  assert.equal(unauthenticatedQuote.status, 401);
  const ibadanQuote = await jsonRequest(`${baseUrl}/api/orders/quote`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 2, price: 0 }],
    address: "No 14 Example Street, Ibadan, Oyo State"
  }, customerCookie);
  assert.equal(ibadanQuote.status, 200);
  const quote = await ibadanQuote.json();
  assert.equal(quote.subtotal, 1798);
  assert.equal(quote.deliveryFee, 3500);
  assert.equal(quote.total, 5298);
  assert.equal(quote.items[0].price, 899);
  const ogunQuote = await jsonRequest(`${baseUrl}/api/orders/quote`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 1 }],
    address: "123 Example Street, Abeokuta, Ogun State"
  }, customerCookie);
  assert.equal(ogunQuote.status, 200);
  assert.equal((await ogunQuote.json()).deliveryFee, 2500);
  const unsupportedQuote = await jsonRequest(`${baseUrl}/api/orders/quote`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 1 }],
    address: "123 Example Street, Lagos"
  }, customerCookie);
  assert.equal(unsupportedQuote.status, 503);
  assert.match((await unsupportedQuote.json()).error, /OpenStreetMap/);
  const placedOrder = await jsonRequest(`${baseUrl}/api/orders`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 2, name: "Fake name", price: 0 }],
    name: "Test Recipient",
    phone: "+1 555 123 4567",
    address: "123 Example Street, Abeokuta, Ogun State"
  }, customerCookie);
  assert.equal(placedOrder.status, 201);
  const savedOrder = (await placedOrder.json()).order;
  assert.equal(savedOrder.subtotal, 1798);
  assert.equal(savedOrder.deliveryFee, 2500);
  assert.equal(savedOrder.total, 4298);
  assert.equal(savedOrder.items[0].name, "Volt One Ultra");
  assert.equal(savedOrder.shippingAddress, "123 Example Street, Abeokuta, Ogun State");
  assert.equal(savedOrder.recipientName, "Test Recipient");
  assert.equal(savedOrder.status, "pending_payment");
  assert.equal(savedOrder.paymentStatus, "Awaiting payment");
  assert.deepEqual(savedOrder.paymentDetails, {
    bankName: "Test Bank",
    accountName: "Test Gadget Store",
    accountNumber: "0000000000"
  });
  const unauthenticatedPaymentReport = await jsonRequest(`${baseUrl}/api/orders/${savedOrder.id}/payment-reported`, "POST", {});
  assert.equal(unauthenticatedPaymentReport.status, 401);
  const paymentReport = await jsonRequest(`${baseUrl}/api/orders/${savedOrder.id}/payment-reported`, "POST", {}, customerCookie);
  assert.equal(paymentReport.status, 200);
  assert.equal((await paymentReport.json()).order.status, "payment_reported");
  const duplicatePaymentReport = await jsonRequest(`${baseUrl}/api/orders/${savedOrder.id}/payment-reported`, "POST", {}, customerCookie);
  assert.equal(duplicatePaymentReport.status, 200);
  const orderHistory = await jsonRequest(`${baseUrl}/api/orders`, "GET", undefined, customerCookie);
  assert.equal((await orderHistory.json())[0].id, savedOrder.id);

  const adminLogin = await jsonRequest(`${baseUrl}/api/admin/login`, "POST", {
    email: "owner@example.com",
    password: "test-admin-password"
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = sessionCookie(adminLogin);
  const adminOrders = await jsonRequest(`${baseUrl}/api/admin/orders`, "GET", undefined, adminCookie);
  assert.equal(adminOrders.status, 200);
  const adminOrder = (await adminOrders.json())[0];
  assert.equal(adminOrder.items[0].price, 899);
  assert.equal(typeof adminOrder.items[0].image, "string");

  const unauthorizedAdminAction = await jsonRequest(
    `${baseUrl}/api/admin/orders/${savedOrder.id}`,
    "PATCH",
    { action: "confirm_payment" },
    customerCookie
  );
  assert.equal(unauthorizedAdminAction.status, 403);
  const skippedAdminAction = await jsonRequest(
    `${baseUrl}/api/admin/orders/${savedOrder.id}`,
    "PATCH",
    { action: "mark_delivered" },
    adminCookie
  );
  assert.equal(skippedAdminAction.status, 400);
  const paymentConfirmed = await jsonRequest(
    `${baseUrl}/api/admin/orders/${savedOrder.id}`,
    "PATCH",
    { action: "confirm_payment" },
    adminCookie
  );
  assert.equal(paymentConfirmed.status, 200);
  assert.equal((await paymentConfirmed.json()).order.status, "confirmed");
  for (const action of ["mark_shipping", "mark_in_transit", "mark_delivered"]) {
    const response = await jsonRequest(
      `${baseUrl}/api/admin/orders/${savedOrder.id}`,
      "PATCH",
      { action },
      adminCookie
    );
    assert.equal(response.status, 400);
  }

  const secondOrderResponse = await jsonRequest(`${baseUrl}/api/orders`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 1 }],
    name: "Test Recipient",
    phone: "+1 555 123 4567",
    address: "123 Example Street, Abeokuta, Ogun State"
  }, customerCookie);
  assert.equal(secondOrderResponse.status, 201);
  const secondOrder = (await secondOrderResponse.json()).order;
  const cancelledOrderResponse = await jsonRequest(
    `${baseUrl}/api/admin/orders/${secondOrder.id}`,
    "PATCH",
    { action: "cancel" },
    adminCookie
  );
  assert.equal(cancelledOrderResponse.status, 200);
  assert.equal((await cancelledOrderResponse.json()).order.status, "cancelled");

  const duplicate = await jsonRequest(`${baseUrl}/api/auth/register`, "POST", {
    name: "Test Customer",
    email: "customer@example.com",
    password: "customer-password",
    phone: "+1 555 123 4567",
    address: "123 Example Street, Test City"
  });
  assert.equal(duplicate.status, 409);

  const login = await jsonRequest(`${baseUrl}/api/auth/login`, "POST", {
    email: "customer@example.com",
    password: "customer-password"
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.email, "customer@example.com");
});

test("approves riders, enforces delivery codes, and pays weekly commission", async t => {
  const smsMessages = [];
  const smsRequests = [];
  const emails = [];
  let tokenRequest;
  const app = await createTestApp(t, {
    orderNotificationEmail: "orders@example.com",
    orderNotificationPhones: "08011111111, 08022222222, 08033333333",
    deliveryOtpSecret: "delivery-test-secret-with-at-least-32-characters",
    brevoSmsSender: "AMGadget",
    brevoOAuthClientId: "test-oauth-client",
    brevoOAuthClientSecret: "test-oauth-secret",
    brevoFetch: async (url, options) => {
      if (url === "https://api.brevo.com/realms/partner/oauth/token") {
        tokenRequest = options;
        return new Response(JSON.stringify({ access_token: "test-sms-token", expires_in: 3600 }), { status: 200 });
      }
      if (url === "https://api.brevo.com/v3/transactionalSMS/send") {
        smsMessages.push(JSON.parse(options.body));
        smsRequests.push(options);
        return new Response("{}", { status: 201 });
      }
      if (url === "https://api.brevo.com/v3/smtp/email") {
        emails.push(JSON.parse(options.body));
        return new Response("{}", { status: 201 });
      }
      throw new Error(`Unexpected Brevo URL: ${url}`);
    }
  });
  const baseUrl = await app.listen();

  const riderApplication = await jsonRequest(`${baseUrl}/api/rider/register`, "POST", {
    name: "Test Rider",
    email: "rider@example.com",
    phone: "+234 801 234 5678",
    password: "rider-password",
    vehicleType: "Motorcycle",
    licensePlate: "ABC 123 XY",
    bankName: "Test Bank",
    accountName: "Test Rider",
    accountNumber: "1234567890"
  });
  assert.equal(riderApplication.status, 201);
  assert.equal(riderApplication.headers.get("set-cookie"), null);
  assert.match((await riderApplication.json()).message, /admin approves/);
  const duplicateCustomerEmail = await jsonRequest(`${baseUrl}/api/auth/register`, "POST", {
    name: "Rider as Customer",
    email: "rider@example.com",
    password: "customer-password",
    phone: "+234 801 234 5678",
    address: "123 Example Street, Abeokuta, Ogun State"
  });
  assert.equal(duplicateCustomerEmail.status, 409);
  const pendingLogin = await jsonRequest(`${baseUrl}/api/rider/login`, "POST", {
    email: "rider@example.com",
    password: "rider-password"
  });
  assert.equal(pendingLogin.status, 403);

  const adminLogin = await jsonRequest(`${baseUrl}/api/admin/login`, "POST", {
    email: "owner@example.com",
    password: "test-admin-password"
  });
  const adminCookie = sessionCookie(adminLogin);
  const pendingRiders = await jsonRequest(`${baseUrl}/api/admin/riders`, "GET", undefined, adminCookie);
  assert.equal(pendingRiders.status, 200);
  const rider = (await pendingRiders.json())[0];
  assert.equal(rider.status, "pending");
  assert.equal("passwordHash" in rider, false);
  const approval = await jsonRequest(`${baseUrl}/api/admin/riders/${rider.id}`, "PATCH", { action: "approve" }, adminCookie);
  assert.equal(approval.status, 200);

  const riderLogin = await jsonRequest(`${baseUrl}/api/rider/login`, "POST", {
    email: "rider@example.com",
    password: "rider-password"
  });
  assert.equal(riderLogin.status, 200);
  const riderCookie = sessionCookie(riderLogin);
  const customerRegistration = await jsonRequest(`${baseUrl}/api/auth/register`, "POST", {
    name: "Delivery Customer",
    email: "delivery-customer@example.com",
    password: "customer-password",
    phone: "+234 801 222 3344",
    address: "123 Example Street, Abeokuta, Ogun State"
  });
  const customerCookie = sessionCookie(customerRegistration);
  const createdOrderResponse = await jsonRequest(`${baseUrl}/api/orders`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 1 }],
    name: "Delivery Customer",
    phone: "+234 801 222 3344",
    address: "123 Example Street, Abeokuta, Ogun State"
  }, customerCookie);
  assert.equal(createdOrderResponse.status, 201);
  const orderId = (await createdOrderResponse.json()).order.id;
  const paymentReport = await jsonRequest(`${baseUrl}/api/orders/${orderId}/payment-reported`, "POST", {}, customerCookie);
  assert.equal(paymentReport.status, 200);
  const confirmed = await jsonRequest(`${baseUrl}/api/admin/orders/${orderId}`, "PATCH", { action: "confirm_payment" }, adminCookie);
  assert.equal((await confirmed.json()).order.status, "confirmed");
  const assigned = await jsonRequest(`${baseUrl}/api/admin/orders/${orderId}`, "PATCH", {
    action: "mark_shipping",
    riderId: rider.id
  }, adminCookie);
  assert.equal(assigned.status, 200);
  assert.equal((await assigned.json()).order.status, "shipping");

  const initialDashboard = await jsonRequest(`${baseUrl}/api/rider/dashboard`, "GET", undefined, riderCookie);
  assert.equal(initialDashboard.status, 200);
  assert.equal((await initialDashboard.json()).orders[0].status, "shipping");
  const started = await jsonRequest(`${baseUrl}/api/rider/orders/${orderId}/start`, "PATCH", {}, riderCookie);
  assert.equal(started.status, 200);
  const requestedCode = await jsonRequest(`${baseUrl}/api/rider/orders/${orderId}/request-code`, "POST", {}, riderCookie);
  assert.equal(requestedCode.status, 200);
  const requestedCodeResult = await requestedCode.json();
  assert.doesNotMatch(JSON.stringify(requestedCodeResult), /\b\d{6}\b/);
  assert.match(requestedCodeResult.message, /email and phone/);
  assert.equal(smsMessages.length, 4);
  assert.match(tokenRequest.body, /scope=transactional\.sms%3Awrite/);
  assert.equal(smsRequests[0].headers.authorization, "Bearer test-sms-token");
  assert.equal("api-key" in smsRequests[0].headers, false);
  const customerSms = smsMessages.filter(message => message.recipient === "2348012223344");
  const codeMatch = customerSms[0].content.match(/code: (\d{6})\./);
  assert.ok(codeMatch);
  assert.equal(emails.some(email => email.subject.includes("Delivery confirmation code")), true);

  const customerOrders = await jsonRequest(`${baseUrl}/api/orders`, "GET", undefined, customerCookie);
  const customerOrderPayload = JSON.stringify(await customerOrders.json());
  assert.doesNotMatch(customerOrderPayload, /deliveryCodeHash|deliveryCodeExpiresAt|riderId/);
  const storedOrders = JSON.parse(await fs.readFile(path.join(app.dataDirectory, "orders.json"), "utf8"));
  const storedOrder = storedOrders.find(order => order.id === orderId);
  assert.notEqual(storedOrder.deliveryCodeHash, codeMatch[1]);
  assert.equal("deliveryCode" in storedOrder, false);

  const cooldown = await jsonRequest(`${baseUrl}/api/rider/orders/${orderId}/request-code`, "POST", {}, riderCookie);
  assert.equal(cooldown.status, 429);
  const incorrectCode = codeMatch[1] === "000000" ? "999999" : "000000";
  for (let attemptsRemaining = 4; attemptsRemaining >= 0; attemptsRemaining -= 1) {
    const incorrectVerification = await jsonRequest(`${baseUrl}/api/rider/orders/${orderId}/verify-code`, "POST", {
      code: incorrectCode
    }, riderCookie);
    assert.equal(incorrectVerification.status, 400);
    assert.equal((await incorrectVerification.json()).attemptsRemaining, attemptsRemaining);
  }
  const lockedVerification = await jsonRequest(`${baseUrl}/api/rider/orders/${orderId}/verify-code`, "POST", {
    code: codeMatch[1]
  }, riderCookie);
  assert.equal(lockedVerification.status, 429);
  const refreshedOrders = JSON.parse(await fs.readFile(path.join(app.dataDirectory, "orders.json"), "utf8"));
  refreshedOrders.find(order => order.id === orderId).deliveryCodeRequestedAt = new Date(Date.now() - 61000).toISOString();
  await fs.writeFile(path.join(app.dataDirectory, "orders.json"), `${JSON.stringify(refreshedOrders, null, 2)}\n`);
  const resentCode = await jsonRequest(`${baseUrl}/api/rider/orders/${orderId}/request-code`, "POST", {}, riderCookie);
  assert.equal(resentCode.status, 200);
  const resentCustomerSms = smsMessages.filter(message => message.recipient === "2348012223344");
  const resentCodeMatch = resentCustomerSms[1].content.match(/code: (\d{6})\./);
  assert.ok(resentCodeMatch);
  const verified = await jsonRequest(`${baseUrl}/api/rider/orders/${orderId}/verify-code`, "POST", {
    code: resentCodeMatch[1]
  }, riderCookie);
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).order.riderCommission, 75);
  const deliveryAlert = emails.find(email =>
    email.to[0].email === "orders@example.com" && email.subject.includes("Order delivered")
  );
  assert.ok(deliveryAlert);
  assert.match(deliveryAlert.textContent, /Delivered by: Test Rider/);
  const deliveredCustomerEmail = emails.find(email =>
    email.to[0].email === "delivery-customer@example.com" && email.subject.includes("Delivered")
  );
  assert.ok(deliveredCustomerEmail);
  assert.match(deliveredCustomerEmail.textContent, /Delivered by: Test Rider/);
  assert.equal(smsMessages.filter(message => message.content.includes(`Order ${orderId.slice(0, 8)} delivered by Test Rider`)).length, 3);

  const completedDashboard = await jsonRequest(`${baseUrl}/api/rider/dashboard`, "GET", undefined, riderCookie);
  const completedData = await completedDashboard.json();
  assert.equal(completedData.earnings.availableBalance, 75);
  assert.equal(completedData.earnings.canRequestPayout, true);
  const payout = await jsonRequest(`${baseUrl}/api/rider/payout-requests`, "POST", {}, riderCookie);
  assert.equal(payout.status, 201);
  assert.equal((await payout.json()).payoutRequest.amount, 75);
  const payoutAlert = emails.find(email =>
    email.to[0].email === "orders@example.com" && email.subject.includes("Payout request from Test Rider")
  );
  assert.ok(payoutAlert);
  assert.match(payoutAlert.textContent, /Amount requested: ₦75\.00/);
  assert.equal(smsMessages.filter(message => message.content.includes("Payout request from Test Rider")).length, 3);
  const duplicatePayout = await jsonRequest(`${baseUrl}/api/rider/payout-requests`, "POST", {}, riderCookie);
  assert.equal(duplicatePayout.status, 409);

  const payoutList = await jsonRequest(`${baseUrl}/api/admin/payout-requests`, "GET", undefined, adminCookie);
  assert.equal(payoutList.status, 200);
  const payoutRecord = (await payoutList.json())[0];
  assert.equal(payoutRecord.accountNumber, "1234567890");
  const payoutReview = await jsonRequest(`${baseUrl}/api/admin/payout-requests/${payoutRecord.id}`, "PATCH", {
    action: "mark_paid"
  }, adminCookie);
  assert.equal(payoutReview.status, 200);
  const paidDashboard = await jsonRequest(`${baseUrl}/api/rider/dashboard`, "GET", undefined, riderCookie);
  assert.equal((await paidDashboard.json()).earnings.availableBalance, 0);
});

test("marks session cookies Secure in production", async t => {
  const app = await createTestApp(t, { secureCookies: true });
  const baseUrl = await app.listen();
  const registration = await jsonRequest(`${baseUrl}/api/auth/register`, "POST", {
    name: "Secure Cookie Customer",
    email: "secure@example.com",
    password: "customer-password",
    phone: "+1 555 123 4567",
    address: "123 Example Street, Test City"
  });

  assert.equal(registration.status, 201);
  assert.match(registration.headers.get("set-cookie"), /; Secure/);
});

test("adds security headers, rejects cross-origin mutations, and limits failed logins", async t => {
  const app = await createTestApp(t, { allowedOrigins: ["https://amgadget.netlify.app"] });
  const baseUrl = await app.listen();

  const shopPage = await fetch(`${baseUrl}/app`);
  assert.equal(shopPage.headers.get("x-frame-options"), "DENY");
  assert.equal(shopPage.headers.get("x-content-type-options"), "nosniff");
  assert.equal(shopPage.headers.get("x-powered-by"), null);
  assert.equal(shopPage.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.match(shopPage.headers.get("permissions-policy"), /microphone=\(self\)/);
  assert.match(shopPage.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(shopPage.headers.get("content-security-policy"), /script-src 'self' 'sha256-BkKP2XO6WOEc3kXOiLr2ZoY83hamalKjPY9xBcbXVuw='/);
  assert.match(shopPage.headers.get("content-security-policy"), /stun:/);
  const products = await fetch(`${baseUrl}/api/products`);
  assert.equal(products.headers.get("referrer-policy"), "strict-origin-when-cross-origin");

  const malformedJson = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{\"email\":"
  });
  assert.equal(malformedJson.status, 400);
  assert.deepEqual(await malformedJson.json(), { error: "Request body must be valid JSON." });

  const crossOriginLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://attacker.example"
    },
    body: JSON.stringify({ email: "customer@example.com", password: "wrong-password" })
  });
  assert.equal(crossOriginLogin.status, 403);

  const netlifyLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://amgadget.netlify.app"
    },
    body: JSON.stringify({ email: "customer@example.com", password: "wrong-password" })
  });
  assert.equal(netlifyLogin.status, 401);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const failedLogin = await jsonRequest(`${baseUrl}/api/auth/login`, "POST", {
      email: "locked@example.com",
      password: "wrong-password"
    });
    assert.equal(failedLogin.status, 401);
  }
  const rateLimitedLogin = await jsonRequest(`${baseUrl}/api/auth/login`, "POST", {
    email: "locked@example.com",
    password: "wrong-password"
  });
  assert.equal(rateLimitedLogin.status, 429);
  assert.match(rateLimitedLogin.headers.get("retry-after"), /^\d+$/);
});

test("stores customer data, sessions, and avatars in Supabase when configured", async t => {
  const collections = new Map();
  const avatars = new Map();
  const supabaseStore = {
    async getCollection(collection) {
      return collections.has(collection)
        ? JSON.parse(JSON.stringify(collections.get(collection)))
        : null;
    },
    async setCollection(collection, records) {
      collections.set(collection, JSON.parse(JSON.stringify(records)));
    },
    async uploadAvatar(objectPath, buffer, contentType) {
      avatars.set(objectPath, { buffer: Buffer.from(buffer), contentType });
    },
    async downloadAvatar(objectPath) {
      return avatars.get(objectPath);
    }
  };
  const app = await createTestApp(t, { supabaseStore });
  let baseUrl = await app.listen();

  const productsResponse = await jsonRequest(`${baseUrl}/api/products`);
  assert.equal(productsResponse.status, 200);
  assert.equal(collections.get("products").length > 0, true);

  const registration = await jsonRequest(`${baseUrl}/api/auth/register`, "POST", {
    name: "Supabase Customer",
    email: "supabase@example.com",
    password: "customer-password",
    phone: "+1 555 123 4567",
    address: "123 Example Street, Test City",
    avatar: {
      type: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S2cAAAAASUVORK5CYII="
    }
  });
  assert.equal(registration.status, 201);
  const cookie = sessionCookie(registration);
  const storedUser = collections.get("users")[0];
  assert.equal(storedUser.passwordHash !== "customer-password", true);
  assert.equal(storedUser.avatarFile.startsWith(`${storedUser.id}/`), true);
  assert.equal(collections.get("sessions").length, 1);
  assert.equal(avatars.has(storedUser.avatarFile), true);
  await assert.rejects(fs.readFile(path.join(app.dataDirectory, "users.json")), { code: "ENOENT" });

  const avatar = await jsonRequest(`${baseUrl}/api/auth/avatar`, "GET", undefined, cookie);
  assert.equal(avatar.status, 200);
  assert.equal(avatar.headers.get("content-type"), "image/png");

  await app.close();
  app.restart();
  baseUrl = await app.listen();
  const persistedSession = await jsonRequest(`${baseUrl}/api/auth/session`, "GET", undefined, cookie);
  assert.equal((await persistedSession.json()).user.email, "supabase@example.com");
});

test("sends Brevo welcome, order, and admin status emails", async t => {
  const sentEmails = [];
  const app = await createTestApp(t, {
    brevoFetch: async (url, options) => {
      sentEmails.push({ url, options: { ...options, body: JSON.parse(options.body) } });
      return { ok: true, status: 201 };
    }
  });
  const baseUrl = await app.listen();

  const registration = await jsonRequest(`${baseUrl}/api/auth/register`, "POST", {
    name: "<b>Test Customer</b>",
    email: "customer@example.com",
    password: "customer-password",
    phone: "+1 555 123 4567",
    address: "123 Example Street, Test City"
  });
  assert.equal(registration.status, 201);
  const customerCookie = sessionCookie(registration);
  assert.equal(sentEmails[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(sentEmails[0].options.headers["api-key"], "test-brevo-api-key");
  assert.equal(sentEmails[0].options.body.to[0].email, "customer@example.com");
  assert.match(sentEmails[0].options.body.htmlContent, /&lt;b&gt;Test Customer&lt;\/b&gt;/);
  assert.match(sentEmails[0].options.body.htmlContent, /A&amp;M Gadget/);
  assert.match(sentEmails[0].options.body.htmlContent, /<!doctype html>/i);
  assert.equal(sentEmails[0].options.body.subject, "Welcome to A&M Gadget");

  const orderResponse = await jsonRequest(`${baseUrl}/api/orders`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 1 }],
    name: "Test Recipient",
    phone: "+1 555 123 4567",
    address: "123 Example Street, Abeokuta, Ogun State"
  }, customerCookie);
  assert.equal(orderResponse.status, 201);
  const order = (await orderResponse.json()).order;
  assert.equal(sentEmails.length, 3);
  assert.equal(sentEmails[1].options.body.to[0].email, "customer@example.com");
  assert.match(sentEmails[1].options.body.subject, /We received your order/);
  assert.match(sentEmails[1].options.body.textContent, new RegExp(order.id));
  assert.match(sentEmails[1].options.body.htmlContent, /Volt One Ultra/);
  assert.match(sentEmails[1].options.body.htmlContent, /data:image\/jpeg;base64,/);
  assert.equal(sentEmails[2].options.body.to[0].email, "owner@example.com");
  assert.match(sentEmails[2].options.body.subject, /New order received/);

  const paymentReport = await jsonRequest(`${baseUrl}/api/orders/${order.id}/payment-reported`, "POST", {}, customerCookie);
  assert.equal(paymentReport.status, 200);
  const adminLogin = await jsonRequest(`${baseUrl}/api/admin/login`, "POST", {
    email: "owner@example.com",
    password: "test-admin-password"
  });
  const adminCookie = sessionCookie(adminLogin);
  const statusChange = await jsonRequest(`${baseUrl}/api/admin/orders/${order.id}`, "PATCH", {
    action: "confirm_payment"
  }, adminCookie);
  assert.equal(statusChange.status, 200);
  assert.equal(sentEmails.length, 4);
  assert.equal(sentEmails[3].options.body.to[0].email, "customer@example.com");
  assert.match(sentEmails[3].options.body.subject, /Payment confirmed/);
});

test("sends new order notifications to the configured store email and phone numbers", async t => {
  const sentEmails = [];
  const sentSms = [];
  const app = await createTestApp(t, {
    orderNotificationEmail: "orders@example.com",
    orderNotificationPhones: "08011111111, 08022222222, 08033333333",
    brevoSmsSender: "AMGadget",
    brevoOAuthClientId: "test-oauth-client",
    brevoOAuthClientSecret: "test-oauth-secret",
    brevoFetch: async (url, options) => {
      if (url === "https://api.brevo.com/realms/partner/oauth/token") {
        return new Response(JSON.stringify({ access_token: "test-sms-token", expires_in: 3600 }), { status: 200 });
      }
      if (url === "https://api.brevo.com/v3/transactionalSMS/send") {
        sentSms.push(JSON.parse(options.body));
        return new Response("{}", { status: 201 });
      }
      if (url === "https://api.brevo.com/v3/smtp/email") {
        sentEmails.push(JSON.parse(options.body));
        return new Response("{}", { status: 201 });
      }
      throw new Error(`Unexpected Brevo URL: ${url}`);
    }
  });
  const baseUrl = await app.listen();

  const registration = await jsonRequest(`${baseUrl}/api/auth/register`, "POST", {
    name: "Test Customer",
    email: "customer@example.com",
    password: "customer-password",
    phone: "+234 801 222 3344",
    address: "123 Example Street, Abeokuta, Ogun State"
  });
  assert.equal(registration.status, 201);
  const cookie = sessionCookie(registration);
  const response = await jsonRequest(`${baseUrl}/api/orders`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 1 }],
    name: "Test Recipient",
    phone: "+234 801 222 3344",
    address: "123 Example Street, Abeokuta, Ogun State"
  }, cookie);
  assert.equal(response.status, 201);
  const { order } = await response.json();

  const storeEmail = sentEmails.find(email => email.to[0].email === "orders@example.com");
  assert.ok(storeEmail);
  assert.match(storeEmail.subject, new RegExp(order.id.slice(0, 8)));
  assert.ok(storeEmail.textContent.includes(order.recipientPhone));
  assert.deepEqual(sentSms.map(message => message.recipient), [
    "2348011111111",
    "2348022222222",
    "2348033333333"
  ]);
  assert.ok(sentSms.every(message => message.content.includes(order.id.slice(0, 8))));
});

test("keeps customer, rider, and admin sessions after restarts until logout", async t => {
  const app = await createTestApp(t);
  let baseUrl = await app.listen();

  const registration = await jsonRequest(`${baseUrl}/api/auth/register`, "POST", {
    name: "Test Customer",
    email: "customer@example.com",
    password: "customer-password",
    phone: "+1 555 123 4567",
    address: "123 Example Street, Test City"
  });
  assert.equal(registration.status, 201);
  const customerCookie = sessionCookie(registration);
  assert.match(registration.headers.get("set-cookie"), /Max-Age=34560000/);
  const savedSessions = JSON.parse(await fs.readFile(path.join(app.dataDirectory, "sessions.json"), "utf8"));
  assert.equal("passwordHash" in savedSessions[0].user, false);
  assert.equal("salt" in savedSessions[0].user, false);

  const adminLogin = await jsonRequest(`${baseUrl}/api/admin/login`, "POST", {
    email: "owner@example.com",
    password: "test-admin-password"
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = sessionCookie(adminLogin);

  const riderApplication = await jsonRequest(`${baseUrl}/api/rider/register`, "POST", {
    name: "Test Rider",
    email: "rider@example.com",
    phone: "+234 801 234 5678",
    password: "rider-password",
    vehicleType: "Motorcycle",
    licensePlate: "ABC 123 XY",
    bankName: "Test Bank",
    accountName: "Test Rider",
    accountNumber: "1234567890"
  });
  assert.equal(riderApplication.status, 201);
  const pendingRiders = await jsonRequest(`${baseUrl}/api/admin/riders`, "GET", undefined, adminCookie);
  const rider = (await pendingRiders.json())[0];
  const approval = await jsonRequest(`${baseUrl}/api/admin/riders/${rider.id}`, "PATCH", { action: "approve" }, adminCookie);
  assert.equal(approval.status, 200);
  const riderLogin = await jsonRequest(`${baseUrl}/api/rider/login`, "POST", {
    email: "rider@example.com",
    password: "rider-password"
  });
  assert.equal(riderLogin.status, 200);
  const riderCookie = sessionCookie(riderLogin);
  assert.match(riderLogin.headers.get("set-cookie"), /Max-Age=34560000/);

  await app.close();
  app.restart();
  baseUrl = await app.listen();

  const customerSession = await jsonRequest(`${baseUrl}/api/auth/session`, "GET", undefined, customerCookie);
  assert.equal((await customerSession.json()).user.role, "customer");
  const customerOrders = await jsonRequest(`${baseUrl}/api/orders`, "GET", undefined, customerCookie);
  assert.equal(customerOrders.status, 200);

  const adminSession = await jsonRequest(`${baseUrl}/api/auth/session`, "GET", undefined, adminCookie);
  assert.equal((await adminSession.json()).user.role, "admin");
  const adminOrders = await jsonRequest(`${baseUrl}/api/admin/orders`, "GET", undefined, adminCookie);
  assert.equal(adminOrders.status, 200);
  const riderSession = await jsonRequest(`${baseUrl}/api/auth/session`, "GET", undefined, riderCookie);
  assert.equal((await riderSession.json()).user.role, "rider");
  const riderDashboard = await jsonRequest(`${baseUrl}/api/rider/dashboard`, "GET", undefined, riderCookie);
  assert.equal(riderDashboard.status, 200);
  const privateSessions = await fetch(`${baseUrl}/data/sessions.json`);
  assert.equal(privateSessions.status, 404);

  const customerLogout = await jsonRequest(`${baseUrl}/api/auth/logout`, "POST", {}, customerCookie);
  const riderLogout = await jsonRequest(`${baseUrl}/api/auth/logout`, "POST", {}, riderCookie);
  const adminLogout = await jsonRequest(`${baseUrl}/api/auth/logout`, "POST", {}, adminCookie);
  assert.equal(customerLogout.status, 200);
  assert.equal(riderLogout.status, 200);
  assert.equal(adminLogout.status, 200);

  await app.close();
  app.restart();
  baseUrl = await app.listen();
  for (const cookie of [customerCookie, riderCookie, adminCookie]) {
    const response = await jsonRequest(`${baseUrl}/api/auth/session`, "GET", undefined, cookie);
    assert.equal((await response.json()).user, null);
  }
});

test("calculates road delivery fees for addresses outside fixed delivery areas", async t => {
  const openMapRequests = [];
  const app = await createTestApp(t, {
    openMapRequestInterval: 0,
    openMapFetch: async (url, options) => {
      openMapRequests.push({ url, options });
      if (url.startsWith("https://nominatim.openstreetmap.org/search?")) {
        const query = new URL(url).searchParams.get("q");
        const isOrigin = query.includes("Ilishan-Remo");
        return {
          ok: true,
          status: 200,
          json: async () => isOrigin ? [{
            lat: isOrigin ? "6.9" : "6.4",
            lon: isOrigin ? "3.7" : "3.4"
          }] : []
        };
      }
      if (url.startsWith("https://photon.komoot.io/api?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            features: [{
              properties: { countrycode: "ng" },
              geometry: { coordinates: ["3.4", "6.4"] }
            }]
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: "Ok", routes: [{ distance: 80200 }] })
      };
    }
  });
  const baseUrl = await app.listen();
  const registration = await jsonRequest(`${baseUrl}/api/auth/register`, "POST", {
    name: "Test Customer",
    email: "route-customer@example.com",
    password: "customer-password",
    phone: "+1 555 123 4567",
    address: "123 Example Street, Test City"
  });
  const cookie = sessionCookie(registration);
  const response = await jsonRequest(`${baseUrl}/api/orders/quote`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 1 }],
    address: "12 Example Road, Lagos, Nigeria"
  }, cookie);
  assert.equal(response.status, 200);
  const quote = await response.json();
  assert.equal(quote.deliveryDistanceKm, 80.2);
  assert.equal(quote.deliveryFee, 3900);
  assert.equal(quote.total, 4799);
  assert.equal(quote.deliveryZoneLabel, "Road distance (80.2 km)");
  assert.equal("apiKey" in quote, false);
  assert.equal(openMapRequests.length, 5);
  const geocodeRequests = openMapRequests.filter(request => request.url.startsWith("https://nominatim.openstreetmap.org/search?"));
  const photonRequest = openMapRequests.find(request => request.url.startsWith("https://photon.komoot.io/api?"));
  const routeRequest = openMapRequests.find(request => request.url.startsWith("https://router.project-osrm.org/route/v1/driving/"));
  assert.equal(geocodeRequests.length, 3);
  assert.ok(geocodeRequests.every(request => request.options.headers["User-Agent"] === "AMGadget/1.0"));
  assert.ok(geocodeRequests.some(request => new URL(request.url).searchParams.get("q") === "Ilishan-Remo, Ogun State, Nigeria"));
  assert.ok(geocodeRequests.some(request => new URL(request.url).searchParams.get("q") === "Lagos, Nigeria"));
  assert.ok(photonRequest);
  assert.ok(photonRequest.options.headers["User-Agent"] === "AMGadget/1.0");
  assert.ok(routeRequest);
  assert.match(routeRequest.url, /\/route\/v1\/driving\/3\.7,6\.9;3\.4,6\.4\?/);

  const ogunResponse = await jsonRequest(`${baseUrl}/api/orders/quote`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 1 }],
    address: "123 Example Street, Abeokuta, Ogun State"
  }, cookie);
  assert.equal((await ogunResponse.json()).deliveryFee, 2500);
  const ibadanResponse = await jsonRequest(`${baseUrl}/api/orders/quote`, "POST", {
    items: [{ id: "volt-one-ultra", quantity: 1 }],
    address: "14 Example Street, Ibadan, Oyo State"
  }, cookie);
  assert.equal((await ibadanResponse.json()).deliveryFee, 3500);
  assert.equal(openMapRequests.length, 5);
});

test("exposes customer and order lists only to admins", async t => {
  const app = await createTestApp(t);
  const baseUrl = await app.listen();

  const forbiddenUsers = await fetch(`${baseUrl}/api/admin/users`);
  const forbiddenOrders = await fetch(`${baseUrl}/api/admin/orders`);
  assert.equal(forbiddenUsers.status, 403);
  assert.equal(forbiddenOrders.status, 403);

  const adminLogin = await jsonRequest(`${baseUrl}/api/admin/login`, "POST", {
    email: "owner@example.com",
    password: "test-admin-password"
  });
  assert.equal(adminLogin.status, 200);
  const cookie = sessionCookie(adminLogin);
  await fs.writeFile(path.join(app.dataDirectory, "users.json"), JSON.stringify([{
    id: "customer-1",
    name: "Test Customer",
    email: "customer@example.com",
    phone: "+1 555 123 4567",
    address: "123 Example Street, Test City",
    avatarFile: "private-photo.jpg",
    passwordHash: "private-hash",
    salt: "private-salt"
  }]));
  await fs.writeFile(path.join(app.dataDirectory, "orders.json"), JSON.stringify([{
    id: "order-1",
    userId: "customer-1",
    createdAt: "2026-11-20T12:00:00.000Z",
    status: "Received",
    paymentStatus: "Not processed",
    shippingAddress: "123 Example Street, Test City",
    items: [{ id: "volt-one-ultra", name: "Volt One Ultra", price: 899, quantity: 1 }],
    total: 899
  }]));

  const usersResponse = await jsonRequest(`${baseUrl}/api/admin/users`, "GET", undefined, cookie);
  assert.equal(usersResponse.status, 200);
  const users = await usersResponse.json();
  assert.equal(users[0].name, "Test Customer");
  assert.equal(users[0].hasAvatar, true);
  assert.equal("passwordHash" in users[0], false);
  assert.equal("avatarFile" in users[0], false);

  const ordersResponse = await jsonRequest(`${baseUrl}/api/admin/orders`, "GET", undefined, cookie);
  assert.equal(ordersResponse.status, 200);
  const orders = await ordersResponse.json();
  assert.equal(orders[0].customerName, "Test Customer");
  assert.equal(orders[0].customerEmail, "customer@example.com");
  assert.equal(orders[0].items[0].name, "Volt One Ultra");
  assert.equal(orders[0].total, 899);
});

test("restricts product creation to the admin and persists added products", async t => {
  const app = await createTestApp(t);
  let baseUrl = await app.listen();
  const product = {
    name: "Test Tablet",
    category: "Tablets",
    description: "A test tablet with a bright screen for everyday reading, video, and browsing.",
    price: "599.99",
    stock: "6",
    oldPrice: "",
    type: "laptop",
    badge: "New"
  };
  const unauthorized = await jsonRequest(`${baseUrl}/api/admin/products`, "POST", product);
  assert.equal(unauthorized.status, 403);
  const unauthorizedUpdate = await jsonRequest(`${baseUrl}/api/admin/products/volt-one-ultra`, "PUT", product);
  assert.equal(unauthorizedUpdate.status, 403);
  const unauthorizedDelete = await jsonRequest(`${baseUrl}/api/admin/products/volt-one-ultra`, "DELETE");
  assert.equal(unauthorizedDelete.status, 403);

  const adminLogin = await jsonRequest(`${baseUrl}/api/admin/login`, "POST", {
    email: "owner@example.com",
    password: "test-admin-password"
  });
  assert.equal(adminLogin.status, 200);
  const cookie = sessionCookie(adminLogin);

  const invalidProduct = await jsonRequest(`${baseUrl}/api/admin/products`, "POST", {
    ...product,
    type: "invalid"
  }, cookie);
  assert.equal(invalidProduct.status, 400);
  const invalidStock = await jsonRequest(`${baseUrl}/api/admin/products`, "POST", {
    ...product,
    stock: "-1"
  }, cookie);
  assert.equal(invalidStock.status, 400);
  const invalidImage = await jsonRequest(`${baseUrl}/api/admin/products`, "POST", {
    ...product,
    image: "https://example.com/product.svg"
  }, cookie);
  assert.equal(invalidImage.status, 400);

  const creation = await jsonRequest(`${baseUrl}/api/admin/products`, "POST", product, cookie);
  assert.equal(creation.status, 201);
  const createdProduct = await creation.json();
  assert.equal(createdProduct.name, "Test Tablet");
  assert.equal(createdProduct.description, product.description);
  assert.equal(createdProduct.image, "/images/products/laptop.jpg");
  assert.equal(createdProduct.stock, 6);

  const update = await jsonRequest(`${baseUrl}/api/admin/products/${createdProduct.id}`, "PUT", {
    ...product,
    name: "Updated Test Tablet",
    price: "649.99",
    image: "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-16-pro?wid=512&fmt=jpeg"
  }, cookie);
  assert.equal(update.status, 200);
  const updatedProduct = await update.json();
  assert.equal(updatedProduct.id, createdProduct.id);
  assert.equal(updatedProduct.name, "Updated Test Tablet");
  assert.equal(updatedProduct.price, 649.99);
  assert.equal(updatedProduct.image, "https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-16-pro?wid=512&fmt=jpeg");

  const deletion = await jsonRequest(`${baseUrl}/api/admin/products/${createdProduct.id}`, "DELETE", undefined, cookie);
  assert.equal(deletion.status, 200);
  assert.equal((await deletion.json()).id, createdProduct.id);
  const missingProduct = await jsonRequest(`${baseUrl}/api/admin/products/${createdProduct.id}`, "DELETE", undefined, cookie);
  assert.equal(missingProduct.status, 404);

  await app.close();
  app.restart();
  baseUrl = await app.listen();
  const productsResponse = await fetch(`${baseUrl}/api/products`);
  const products = await productsResponse.json();
  assert.equal(products.some(item => item.name === "Updated Test Tablet"), false);
  assert.equal(products.some(item => item.id === createdProduct.id), false);
});
