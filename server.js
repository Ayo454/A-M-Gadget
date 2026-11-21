const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const publicDirectory = __dirname;
const sessionCookieLifetime = 400 * 24 * 60 * 60;
const productTypes = new Set(["phone", "laptop", "headphones", "watch"]);
const deliveryZones = [
  { id: "ogun", label: "Within Ogun State", fee: 2500 },
  { id: "ibadan", label: "Ibadan, Oyo State", fee: 3500 }
];
const ogunLocalities = [
  "abeokuta", "agbara", "akute", "ifo", "ijebu igbo", "ijebu ode",
  "ilaro", "ibafo", "mowe", "ota", "sagamu", "sango ota"
];
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};
const defaultProducts = [
  { id: "volt-one-ultra", name: "Volt One Ultra", category: "Smartphones", description: "A premium everyday phone with a vivid display, a versatile camera system, and fast performance for work and entertainment.", price: 899, oldPrice: 999, type: "phone", image: "/images/products/phone.jpg", stock: 12, badge: "New" },
  { id: "voltbook-air-14", name: "VoltBook Air 14", category: "Laptops", description: "A slim, lightweight laptop made for moving between work, study, and travel, with a bright screen and all-day productivity in mind.", price: 1299, oldPrice: null, type: "laptop", image: "/images/products/laptop.jpg", stock: 8, badge: "Bestseller" },
  { id: "volt-studio", name: "Volt Studio", category: "Headphones", description: "Comfortable over-ear headphones with rich everyday sound and noise cancellation to help you focus at home or on the move.", price: 349, oldPrice: 429, type: "headphones", image: "/images/products/headphones.jpg", stock: 15, badge: "-18%" },
  { id: "volt-watch-s4", name: "Volt Watch S4", category: "Wearables", description: "A versatile smartwatch for checking notifications, tracking daily activity, and keeping useful tools close throughout the day.", price: 249, oldPrice: null, type: "watch", image: "/images/products/watch.jpg", stock: 10, badge: "New" }
];

function jsonResponse(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(value));
}

function safeEqual(left, right) {
  const leftHash = crypto.createHash("sha256").update(String(left)).digest();
  const rightHash = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function readCookies(request) {
  return Object.fromEntries((request.headers.cookie || "")
    .split(";")
    .map(cookie => cookie.trim())
    .map(cookie => {
      const separator = cookie.indexOf("=");
      return separator < 0 ? ["", ""] : [cookie.slice(0, separator), cookie.slice(separator + 1)];
    })
    .filter(([name, value]) => name && value));
}

function readRequestBody(request, maxLength = 30000) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", chunk => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > maxLength) {
        tooLarge = true;
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
      }
    });
    request.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

async function loadEnvironmentFile() {
  let contents;
  try {
    contents = await fs.readFile(path.join(__dirname, ".env"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  contents.split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) return;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  });
}

function validateAvatar(input) {
  if (input === undefined || input === null) return null;
  const imageTypes = {
    "image/jpeg": { extension: ".jpg", signature: buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
    "image/png": { extension: ".png", signature: buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    "image/webp": { extension: ".webp", signature: buffer => buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" }
  };
  const imageType = typeof input.type === "string" ? imageTypes[input.type] : null;
  if (!imageType || typeof input.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) {
    throw Object.assign(new Error("Choose a valid PNG, JPG, or WebP profile photo."), { status: 400 });
  }
  const buffer = Buffer.from(input.data, "base64");
  if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024 || buffer.toString("base64") !== input.data) {
    throw Object.assign(new Error("The profile photo must be a valid image no larger than 2 MB."), { status: 400 });
  }
  if (!imageType.signature(buffer)) {
    throw Object.assign(new Error("The profile photo content does not match its file type."), { status: 400 });
  }
  return { buffer, contentType: input.type, extension: imageType.extension };
}

function validateProduct(input) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const category = typeof input.category === "string" ? input.category.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const type = typeof input.type === "string" ? input.type : "";
  const badge = typeof input.badge === "string" ? input.badge.trim() : "";
  const imageInput = typeof input.image === "string" ? input.image.trim() : "";
  const stock = Number(input.stock);
  const price = Number(input.price);
  const oldPrice = input.oldPrice === "" || input.oldPrice === null || input.oldPrice === undefined
    ? null
    : Number(input.oldPrice);

  if (!name || name.length > 100) throw Object.assign(new Error("Enter a product name up to 100 characters."), { status: 400 });
  if (!category || category.length > 60) throw Object.assign(new Error("Enter a category up to 60 characters."), { status: 400 });
  if (description.length < 20 || description.length > 1000) {
    throw Object.assign(new Error("Enter a product description between 20 and 1000 characters."), { status: 400 });
  }
  if (!Number.isFinite(price) || price <= 0 || price > 100000000) {
    throw Object.assign(new Error("Enter a valid product price greater than zero."), { status: 400 });
  }
  if (!Number.isInteger(stock) || stock < 0 || stock > 100000000) {
    throw Object.assign(new Error("Enter a whole-number stock quantity of zero or more."), { status: 400 });
  }
  if (oldPrice !== null && (!Number.isFinite(oldPrice) || oldPrice <= 0 || oldPrice > 100000000)) {
    throw Object.assign(new Error("Enter a valid old price or leave it empty."), { status: 400 });
  }
  if (!productTypes.has(type)) {
    throw Object.assign(new Error("Choose a supported product image type."), { status: 400 });
  }
  if (badge.length > 24) throw Object.assign(new Error("The product badge must be 24 characters or fewer."), { status: 400 });

  let image = `/images/products/${type}.jpg`;
  if (imageInput) {
    if (imageInput.startsWith("/") && !imageInput.startsWith("//") &&
        /^\/images\/products\/[A-Za-z0-9._-]+\.jpe?g$/i.test(imageInput)) {
      image = imageInput;
    } else {
      let imageUrl;
      try {
        imageUrl = new URL(imageInput);
      } catch {
        throw Object.assign(new Error("Enter an image URL beginning with http:// or https://, or use a product image path."), { status: 400 });
      }
      if (!["http:", "https:"].includes(imageUrl.protocol) || imageUrl.username || imageUrl.password ||
          (!/\.jpe?g$/i.test(imageUrl.pathname) && imageUrl.searchParams.get("fm") !== "jpg")) {
        throw Object.assign(new Error("Product images must use a public JPG or JPEG URL."), { status: 400 });
      }
      image = imageUrl.href;
    }
  }

  return { id: crypto.randomUUID(), name, category, description, price, oldPrice, type, image, stock, badge };
}

function createServer(options = {}) {
  const dataDirectory = options.dataDirectory || path.join(__dirname, "data");
  const adminEmail = String(options.adminEmail ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const adminPassword = String(options.adminPassword ?? process.env.ADMIN_PASSWORD ?? "");
  const brevoApiKey = String(options.brevoApiKey ?? process.env.BREVO_API_KEY ?? "").trim();
  const brevoSenderEmail = String(options.brevoSenderEmail ?? process.env.BREVO_SENDER_EMAIL ?? "").trim();
  const brevoSenderName = String(options.brevoSenderName ?? process.env.BREVO_SENDER_NAME ?? "A&M Gadget").trim();
  const brevoFetch = options.brevoFetch || globalThis.fetch;
  const deliveryOrigin = String(options.deliveryOrigin ?? process.env.DELIVERY_ORIGIN ?? "Ilishan-Remo, Ogun State, Nigeria").trim();
  const geocoderUrl = String(options.geocoderUrl ?? "https://nominatim.openstreetmap.org/search").replace(/\/$/, "");
  const photonUrl = String(options.photonUrl ?? "https://photon.komoot.io/api").replace(/\/$/, "");
  const routerUrl = String(options.routerUrl ?? "https://router.project-osrm.org").replace(/\/$/, "");
  const openMapFetch = options.openMapFetch || globalThis.fetch;
  const paymentBankName = String(options.paymentBankName ?? process.env.PAYMENT_BANK_NAME ?? "").trim();
  const paymentAccountName = String(options.paymentAccountName ?? process.env.PAYMENT_ACCOUNT_NAME ?? "").trim();
  const paymentAccountNumber = String(options.paymentAccountNumber ?? process.env.PAYMENT_ACCOUNT_NUMBER ?? "").trim();
  const openMapRequestInterval = options.openMapRequestInterval ?? 1000;
  let openMapQueue = Promise.resolve();
  let lastOpenMapRequestAt = 0;
  const coordinateCache = new Map();
  const roadDistanceCache = new Map();
  function deliveryAmount(optionName, environmentName, fallback) {
    const configuredValue = options[optionName] ?? process.env[environmentName];
    if (configuredValue === undefined || configuredValue === "") return fallback;
    const amount = Number(configuredValue);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`${environmentName} must be a non-negative number.`);
    }
    return amount;
  }
  const deliveryBaseFee = deliveryAmount("deliveryBaseFee", "DELIVERY_BASE_NGN", 1000);
  const deliveryPerKm = deliveryAmount("deliveryPerKm", "DELIVERY_PER_KM_NGN", 35);
  const minimumDeliveryFee = deliveryAmount("minimumDeliveryFee", "DELIVERY_MINIMUM_NGN", 2500);
  const sessions = new Map();
  let writeQueue = Promise.resolve();
  let sessionsLoadPromise;

  function getPaymentDetails() {
    if (!paymentBankName || !paymentAccountName || !paymentAccountNumber) {
      throw Object.assign(new Error("Bank transfer details are not configured. Contact the store admin before placing an order."), { status: 503 });
    }
    return {
      bankName: paymentBankName,
      accountName: paymentAccountName,
      accountNumber: paymentAccountNumber
    };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function emailCurrency(value) {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value));
  }

  async function emailProductImageSource(image) {
    if (typeof image !== "string" || !image.trim()) return "";
    if (image.startsWith("data:image/")) return image;

    if (image.startsWith("/")) {
      const relativePath = image.slice(1).replace(/[\\/]+/g, path.sep);
      const imagePath = path.resolve(publicDirectory, relativePath);
      if (!imagePath.startsWith(`${publicDirectory}${path.sep}`)) return "";
      try {
        const file = await fs.readFile(imagePath);
        const extension = path.extname(imagePath).toLowerCase();
        const mimeType = extension === ".png" ? "image/png"
          : extension === ".webp" ? "image/webp"
          : extension === ".gif" ? "image/gif"
          : "image/jpeg";
        return `data:${mimeType};base64,${file.toString("base64")}`;
      } catch {
        return "";
      }
    }

    if (/^https?:\/\//i.test(image)) {
      try {
        const response = await globalThis.fetch(image);
        if (!response.ok) return "";
        const contentType = response.headers.get("content-type") || "image/jpeg";
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 3 * 1024 * 1024) return "";
        return `data:${contentType.split(";")[0]};base64,${buffer.toString("base64")}`;
      } catch {
        return "";
      }
    }
    return "";
  }

  async function sendBrevoEmail({ recipientEmail, recipientName, subject, title, paragraphs, items = [] }) {
    if (!brevoApiKey || !brevoSenderEmail) {
      throw new Error("Configure BREVO_API_KEY and BREVO_SENDER_EMAIL to send transactional emails.");
    }
    const safeTitle = escapeHtml(title);
    const safeName = escapeHtml(recipientName);
    const safeParagraphs = paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("");
    const textContent = [`Hello ${recipientName},`, "", ...paragraphs].join("\n");
    const itemCards = (await Promise.all(items.map(async item => {
      const name = escapeHtml(item.name || "Gadget");
      const quantity = Number(item.quantity) || 1;
      const lineTotal = emailCurrency((Number(item.price) || 0) * quantity);
      const imageSource = await emailProductImageSource(item.image);
      const imageHtml = imageSource
        ? `<img src="${escapeHtml(imageSource)}" alt="${name}" width="96" height="96" style="display:block;width:96px;height:96px;border-radius:12px;object-fit:cover;background:#eef1f7;">`
        : "";
      return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px;border:1px solid #e3e7ef;border-radius:14px;">
          <tr>
            <td width="112" valign="middle" style="padding:12px;">${imageHtml}</td>
            <td valign="middle" style="padding:12px 12px 12px 0;">
              <strong style="display:block;color:#101a38;font-size:15px;">${name}</strong>
              <span style="display:block;margin-top:6px;color:#70788a;font-size:14px;">Quantity: ${quantity}</span>
              <strong style="display:block;margin-top:6px;color:#101a38;font-size:15px;">${lineTotal}</strong>
            </td>
          </tr>
        </table>`;
    }))).join("");
    const htmlContent = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="margin:0;padding:0;background:#0d1530;font-family:Arial,Helvetica,sans-serif;color:#172033;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0d1530;">
            <tr>
              <td align="center" style="padding:32px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.18);">
                  <tr>
                    <td style="padding:24px 32px;background:#101a38;border-bottom:4px solid #c8ff4a;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td width="44" valign="middle">
                            <div style="width:38px;height:38px;border-radius:50%;background:#c8ff4a;color:#101a38;text-align:center;font-size:21px;font-weight:800;line-height:38px;">A</div>
                          </td>
                          <td valign="middle" style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:.2px;">A&amp;M Gadget</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:38px 32px 32px;">
                      <h1 style="margin:0 0 20px;color:#101a38;font-size:29px;line-height:1.2;">${safeTitle}</h1>
                      <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">Hello ${safeName},</p>
                      ${safeParagraphs.replace(/<p>/g, '<p style="margin:0 0 12px;font-size:16px;line-height:1.7;color:#384153;">')}
                      ${itemCards}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:20px 32px;background:#f4f6fb;text-align:center;color:#70788a;font-size:13px;line-height:1.6;">
                      A&amp;M Gadget<br>
                      Thank you for shopping with us.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;
    const response = await brevoFetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": brevoApiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: { name: brevoSenderName, email: brevoSenderEmail },
        to: [{ email: recipientEmail, name: recipientName }],
        subject,
        htmlContent,
        textContent
      })
    });
    if (!response.ok) throw new Error(`Brevo returned HTTP ${response.status} while sending email.`);
  }

  async function notifyCustomer(eventName, email) {
    try {
      await sendBrevoEmail(email);
    } catch (error) {
      console.error(`Could not send Brevo ${eventName} email:`, error.message);
    }
  }

  async function notifyOrderStatusChanged(order) {
    try {
      const users = await readStore("users.json", []);
      const customer = users.find(user => user.id === order.userId);
      if (!customer || !customer.email) {
        throw new Error("The customer account email for this order was not found.");
      }
      const statusLabels = {
        pending_payment: "Awaiting payment",
        payment_reported: "Payment reported",
        confirmed: "Payment confirmed",
        shipping: "Preparing for shipment",
        in_transit: "In transit",
        delivered: "Delivered",
        cancelled: "Cancelled"
      };
      const status = statusLabels[order.status] || order.status;
      await notifyCustomer("order status", {
        recipientEmail: customer.email,
        recipientName: customer.name,
        subject: `Order ${order.id.slice(0, 8)} update: ${status}`,
        title: "Your order has been updated",
        items: order.items,
        paragraphs: [
          `Order ${order.id} is now ${status}.`,
          `Payment status: ${order.paymentStatus || "Awaiting payment"}.`,
          `Order total: ${emailCurrency(order.total)}.`
        ]
      });
    } catch (error) {
      console.error("Could not prepare the Brevo order status email:", error.message);
    }
  }

  async function readStore(name, initialValue) {
    const filePath = path.join(dataDirectory, name);
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.mkdir(dataDirectory, { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(initialValue, null, 2)}\n`, { flag: "wx" }).catch(writeError => {
        if (writeError.code !== "EEXIST") throw writeError;
      });
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    }
  }

  async function mutateStore(name, initialValue, update) {
    const operation = writeQueue.then(async () => {
      const store = await readStore(name, initialValue);
      const result = await update(store);
      await fs.writeFile(path.join(dataDirectory, name), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
      return result;
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function fetchOpenMap(url) {
    const operation = openMapQueue.then(async () => {
      const waitMs = Math.max(0, openMapRequestInterval - (Date.now() - lastOpenMapRequestAt));
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      lastOpenMapRequestAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        return await openMapFetch(url, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "AMGadget/1.0"
          },
          signal: controller.signal
        });
      } catch {
        throw Object.assign(new Error("OpenStreetMap services could not be reached. Try again shortly."), { status: 502 });
      } finally {
        clearTimeout(timeout);
      }
    });
    openMapQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function getCoordinates(address) {
    const cacheKey = address.toLowerCase().replace(/\s+/g, " ").trim();
    const cached = coordinateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.coordinates;

    const addressParts = address.split(",").map(part => part.trim()).filter(Boolean);
    const localParts = addressParts.filter(part => !/^nigeria$/i.test(part));
    const searchVariants = [address];
    if (/^\d/.test(localParts[0] || "") && localParts.length > 1) {
      searchVariants.push(localParts.slice(1).join(", "));
    }
    if (localParts.length > 2) searchVariants.push(localParts.slice(-2).join(", "));
    const simplifiedAddress = address
      .replace(/\bState\b/gi, "")
      .replace(/\s*,\s*/g, ", ")
      .replace(/,\s*,/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
    searchVariants.push(simplifiedAddress);

    let coordinates;
    for (const searchVariant of new Set(searchVariants)) {
      const searchAddress = /\bNigeria\b/i.test(searchVariant) ? searchVariant : `${searchVariant}, Nigeria`;
      const response = await fetchOpenMap(`${geocoderUrl}?format=jsonv2&limit=1&countrycodes=ng&q=${encodeURIComponent(searchAddress)}`);
      if (!response.ok) {
        throw Object.assign(new Error("OpenStreetMap address lookup is temporarily unavailable. Try again shortly."), { status: 503 });
      }

      let results;
      try {
        results = await response.json();
      } catch {
        throw Object.assign(new Error("OpenStreetMap returned an invalid address result."), { status: 502 });
      }
      const firstResult = Array.isArray(results) ? results[0] : null;
      if (firstResult) {
        const latitude = Number(firstResult.lat);
        const longitude = Number(firstResult.lon);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          coordinates = { latitude, longitude };
          break;
        }
      }
    }

    if (!coordinates) {
      for (const searchVariant of new Set(searchVariants)) {
        const searchAddress = /\bNigeria\b/i.test(searchVariant) ? searchVariant : `${searchVariant}, Nigeria`;
        const response = await fetchOpenMap(`${photonUrl}?limit=1&lang=en&q=${encodeURIComponent(searchAddress)}`);
        if (!response.ok) {
          throw Object.assign(new Error("OpenStreetMap address lookup is temporarily unavailable. Try again shortly."), { status: 503 });
        }

        let results;
        try {
          results = await response.json();
        } catch {
          throw Object.assign(new Error("OpenStreetMap returned an invalid address result."), { status: 502 });
        }
        const firstFeature = results.features && results.features[0];
        const countryCode = firstFeature && firstFeature.properties && firstFeature.properties.countrycode;
        const position = firstFeature && firstFeature.geometry && firstFeature.geometry.coordinates;
        if (countryCode && countryCode.toLowerCase() !== "ng") continue;
        if (Array.isArray(position) && position.length >= 2) {
          const longitude = Number(position[0]);
          const latitude = Number(position[1]);
          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            coordinates = { latitude, longitude };
            break;
          }
        }
      }
    }

    if (!coordinates) {
      throw Object.assign(new Error("OpenStreetMap could not find this address or nearby town. Check the spelling and include the town or city and state."), { status: 400 });
    }

    if (coordinateCache.size >= 500) coordinateCache.clear();
    coordinateCache.set(cacheKey, { coordinates, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    return coordinates;
  }

  async function getRoadDistanceKm(address) {
    const cacheKey = address.toLowerCase().replace(/\s+/g, " ").trim();
    const cached = roadDistanceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.distanceKm;

    const [origin, destination] = await Promise.all([
      getCoordinates(deliveryOrigin),
      getCoordinates(address)
    ]);
    const routeUrl = `${routerUrl}/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=false&steps=false`;
    const response = await fetchOpenMap(routeUrl);
    if (!response.ok) {
      throw Object.assign(new Error("OpenStreetMap road routing is temporarily unavailable. Try again shortly."), { status: 503 });
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw Object.assign(new Error("OpenStreetMap returned an invalid route result."), { status: 502 });
    }
    const distanceMeters = result.routes && result.routes[0] && result.routes[0].distance;
    if (result.code !== "Ok" || !Number.isFinite(distanceMeters) || distanceMeters <= 0) {
      throw Object.assign(new Error("OpenStreetMap could not find a drivable route. Add a complete street, town or city, and state."), { status: 400 });
    }

    const distanceKm = distanceMeters / 1000;
    if (roadDistanceCache.size >= 500) roadDistanceCache.clear();
    roadDistanceCache.set(cacheKey, { distanceKm, expiresAt: Date.now() + 15 * 60 * 1000 });
    return distanceKm;
  }

  async function createOrderQuote(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw Object.assign(new Error("Order details must be sent as an object."), { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50) {
      throw Object.assign(new Error("Your order must contain between 1 and 50 items."), { status: 400 });
    }
    const address = typeof body.address === "string" ? body.address.trim() : "";
    if (address.length < 5 || address.length > 300) {
      throw Object.assign(new Error("Enter a delivery address between 5 and 300 characters."), { status: 400 });
    }
    const normalizedAddress = address.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
    const addressWords = normalizedAddress.split(/\s+/);
    const paddedAddress = ` ${normalizedAddress} `;
    const isWithinOgun = addressWords.includes("ogun") ||
      ogunLocalities.some(locality => paddedAddress.includes(` ${locality} `));
    let deliveryZone = addressWords.includes("ibadan")
      ? deliveryZones.find(zone => zone.id === "ibadan")
      : isWithinOgun ? deliveryZones.find(zone => zone.id === "ogun") : null;
    let deliveryDistanceKm = null;
    if (!deliveryZone) {
      deliveryDistanceKm = await getRoadDistanceKm(address);
      const calculatedFee = deliveryBaseFee + deliveryDistanceKm * deliveryPerKm;
      deliveryZone = {
        id: "road-distance",
        label: `Road distance (${deliveryDistanceKm.toFixed(1)} km)`,
        fee: Math.max(minimumDeliveryFee, Math.ceil(calculatedFee / 100) * 100)
      };
    }

    const products = await readStore("products.json", defaultProducts);
    const orderableProducts = [
      ...products,
      { id: "volt-studio-pro", name: "Volt Studio Pro", price: 349, type: "headphones", image: "/images/products/headphones.jpg" }
    ];
    const orderItems = new Map();
    for (const requestedItem of body.items) {
      if (!requestedItem || typeof requestedItem !== "object" || Array.isArray(requestedItem) ||
          typeof requestedItem.id !== "string") {
        throw Object.assign(new Error("The order contains an invalid product or quantity."), { status: 400 });
      }
      const product = orderableProducts.find(item => item.id === requestedItem.id);
      const quantity = Number(requestedItem.quantity);
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        throw Object.assign(new Error("The order contains an invalid product or quantity."), { status: 400 });
      }
      const existingItem = orderItems.get(product.id);
      const totalQuantity = quantity + (existingItem ? existingItem.quantity : 0);
      if (totalQuantity > 99) {
        throw Object.assign(new Error("An order cannot contain more than 99 of one product."), { status: 400 });
      }
      if (Number.isInteger(product.stock) && totalQuantity > product.stock) {
        throw Object.assign(new Error(`Only ${product.stock} units of ${product.name} are in stock.`), { status: 400 });
      }
      orderItems.set(product.id, {
        id: product.id,
        name: product.name,
        price: Number(product.price),
        quantity: totalQuantity,
        image: product.image || `/images/products/${product.type || "phone"}.jpg`
      });
    }

    const items = Array.from(orderItems.values());
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return {
      items,
      deliveryZone: deliveryZone.id,
      deliveryZoneLabel: deliveryZone.label,
      deliveryDistanceKm,
      subtotal,
      deliveryFee: deliveryZone.fee,
      total: subtotal + deliveryZone.fee
    };
  }

  function sessionUser(user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone || "",
      address: user.address || "",
      avatarFile: user.avatarFile || null,
      avatarType: user.avatarType || null
    };
  }

  function sessionTokenHash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  async function loadSessions() {
    if (!sessionsLoadPromise) {
      sessionsLoadPromise = (async () => {
        let records;
        try {
          records = JSON.parse(await fs.readFile(path.join(dataDirectory, "sessions.json"), "utf8"));
        } catch (error) {
          if (error.code === "ENOENT") return;
          throw error;
        }
        if (!Array.isArray(records)) throw new Error("The stored sessions file is invalid.");
        records.forEach(record => {
          const user = record && record.user;
          if (!record || typeof record.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(record.tokenHash) ||
              !user || typeof user.id !== "string" || typeof user.email !== "string" ||
              typeof user.name !== "string" || !["admin", "customer"].includes(user.role)) {
            throw new Error("The stored sessions file contains an invalid session.");
          }
          sessions.set(record.tokenHash, { user: sessionUser(user) });
        });
      })();
    }
    return sessionsLoadPromise;
  }

  async function persistSessions() {
    const operation = writeQueue.then(async () => {
      await fs.mkdir(dataDirectory, { recursive: true });
      const sessionFile = path.join(dataDirectory, "sessions.json");
      const temporaryFile = `${sessionFile}.${crypto.randomUUID()}.tmp`;
      const records = Array.from(sessions, ([tokenHash, session]) => ({ tokenHash, user: session.user }));
      try {
        await fs.writeFile(temporaryFile, `${JSON.stringify(records, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        await fs.rename(temporaryFile, sessionFile);
      } catch (error) {
        await fs.rm(temporaryFile, { force: true });
        throw error;
      }
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }

  function getSession(request) {
    const token = readCookies(request).sid;
    const session = token && sessions.get(sessionTokenHash(token));
    return session || null;
  }

  function sessionCookie(token, request) {
    const secure = request.socket.encrypted ? "; Secure" : "";
    return `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionCookieLifetime}${secure}`;
  }

  async function createSession(response, request, user) {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = sessionTokenHash(token);
    sessions.set(tokenHash, { user: sessionUser(user) });
    try {
      await persistSessions();
    } catch (error) {
      sessions.delete(tokenHash);
      throw error;
    }
    response.setHeader("Set-Cookie", sessionCookie(token, request));
    return user;
  }

  function userDetails(session) {
    if (!session) return null;
    const user = session.user;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone || "",
      address: user.address || "",
      avatarUrl: user.avatarFile ? "/api/auth/avatar" : null
    };
  }

  async function api(request, response, url) {
    const route = `${request.method} ${url.pathname}`;

    if (route === "GET /api/products") {
      jsonResponse(response, 200, await readStore("products.json", defaultProducts));
      return;
    }

    if (route === "GET /api/admin/users") {
      const session = getSession(request);
      if (!session || session.user.role !== "admin") {
        jsonResponse(response, 403, { error: "Sign in as the store admin to view customers." });
        return;
      }
      const users = await readStore("users.json", []);
      jsonResponse(response, 200, users.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || "",
        address: user.address || "",
        hasAvatar: Boolean(user.avatarFile)
      })));
      return;
    }

    const adminOrderActionMatch = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (request.method === "PATCH" && adminOrderActionMatch) {
      const session = getSession(request);
      if (!session || session.user.role !== "admin") {
        jsonResponse(response, 403, { error: "Sign in as the store admin to update orders." });
        return;
      }
      const body = await readRequestBody(request);
      const action = body && body.action;
      const transitions = {
        confirm_payment: { from: "payment_reported", to: "confirmed" },
        mark_shipping: { from: "confirmed", to: "shipping" },
        mark_in_transit: { from: "shipping", to: "in_transit" },
        mark_delivered: { from: "in_transit", to: "delivered" }
      };
      if (typeof action !== "string" || (!transitions[action] && action !== "cancel")) {
        throw Object.assign(new Error("Choose a valid order action."), { status: 400 });
      }
      const orderId = decodeURIComponent(adminOrderActionMatch[1]);
      const order = await mutateStore("orders.json", [], orders => {
        const selectedOrder = orders.find(item => item.id === orderId);
        if (!selectedOrder) throw Object.assign(new Error("Order not found."), { status: 404 });
        const currentStatus = selectedOrder.status || "pending_payment";
        const transition = transitions[action];
        const canCancel = action === "cancel" &&
          ["pending_payment", "payment_reported", "confirmed", "shipping", "in_transit"].includes(currentStatus);
        if (!canCancel && (!transition || currentStatus !== transition.from)) {
          throw Object.assign(new Error("That action is not available for the current order status."), { status: 409 });
        }
        selectedOrder.status = canCancel ? "cancelled" : transition.to;
        if (action === "confirm_payment") selectedOrder.paymentStatus = "Confirmed by admin";
        if (canCancel) {
          selectedOrder.paymentStatus = selectedOrder.paymentStatus === "Confirmed by admin"
            ? "Refund required"
            : "Order cancelled";
        }
        selectedOrder.updatedAt = new Date().toISOString();
        return selectedOrder;
      });
      await notifyOrderStatusChanged(order);
      jsonResponse(response, 200, { order });
      return;
    }

    if (route === "GET /api/admin/orders") {
      const session = getSession(request);
      if (!session || session.user.role !== "admin") {
        jsonResponse(response, 403, { error: "Sign in as the store admin to view orders." });
        return;
      }
      const [orders, users, products] = await Promise.all([
        readStore("orders.json", []),
        readStore("users.json", []),
        readStore("products.json", defaultProducts)
      ]);
      const usersById = new Map(users.map(user => [user.id, user]));
      const productsById = new Map(products.map(product => [product.id, product]));
      const adminOrders = orders.map(order => {
        const customer = usersById.get(order.userId);
        return {
          id: order.id,
          customerName: order.recipientName || (customer ? customer.name : "Customer account unavailable"),
          customerEmail: customer ? customer.email : "",
          customerPhone: order.recipientPhone || (customer ? customer.phone || "" : ""),
          createdAt: order.createdAt,
          updatedAt: order.updatedAt || null,
          status: order.status || "pending_payment",
          paymentStatus: order.paymentStatus || "Awaiting payment",
          paymentSubmittedAt: order.paymentSubmittedAt || null,
          shippingAddress: order.shippingAddress,
          items: Array.isArray(order.items) ? order.items.map(item => {
            const product = productsById.get(item.id);
            return {
              ...item,
              image: item.image || (product && product.image) || `/images/products/${(product && product.type) || "phone"}.jpg`
            };
          }) : [],
          subtotal: order.subtotal ?? order.total,
          deliveryFee: order.deliveryFee ?? 0,
          deliveryZone: order.deliveryZone || "",
          deliveryDistanceKm: order.deliveryDistanceKm ?? null,
          total: order.total
        };
      }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      jsonResponse(response, 200, adminOrders);
      return;
    }

    if (route === "GET /api/checkout") {
      const session = getSession(request);
      if (!session || session.user.role !== "customer") {
        jsonResponse(response, 401, { error: "Sign in before checkout. Your bag will stay saved." });
        return;
      }
      jsonResponse(response, 200, { user: userDetails(session) });
      return;
    }

    if (route === "POST /api/orders/quote") {
      const session = getSession(request);
      if (!session || session.user.role !== "customer") {
        jsonResponse(response, 401, { error: "Sign in before checkout. Your bag will stay saved." });
        return;
      }
      const quote = await createOrderQuote(await readRequestBody(request));
      jsonResponse(response, 200, quote);
      return;
    }

    const paymentReportedMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/payment-reported$/);
    if (request.method === "POST" && paymentReportedMatch) {
      const session = getSession(request);
      if (!session || session.user.role !== "customer") {
        jsonResponse(response, 401, { error: "Sign in to report a payment." });
        return;
      }
      const orderId = decodeURIComponent(paymentReportedMatch[1]);
      const order = await mutateStore("orders.json", [], orders => {
        const selectedOrder = orders.find(item => item.id === orderId);
        if (!selectedOrder || selectedOrder.userId !== session.user.id) {
          throw Object.assign(new Error("Order not found."), { status: 404 });
        }
        if (selectedOrder.status === "payment_reported") return selectedOrder;
        if (selectedOrder.status !== "pending_payment") {
          throw Object.assign(new Error("This order is not waiting for a payment report."), { status: 409 });
        }
        selectedOrder.status = "payment_reported";
        selectedOrder.paymentStatus = "Customer reported payment";
        selectedOrder.paymentSubmittedAt = new Date().toISOString();
        selectedOrder.updatedAt = selectedOrder.paymentSubmittedAt;
        return selectedOrder;
      });
      jsonResponse(response, 200, { order });
      return;
    }

    if (route === "GET /api/orders") {
      const session = getSession(request);
      if (!session || session.user.role !== "customer") {
        jsonResponse(response, 401, { error: "Sign in to view your orders." });
        return;
      }
      const orders = await readStore("orders.json", []);
      jsonResponse(response, 200, orders.filter(order => order.userId === session.user.id));
      return;
    }

    if (route === "POST /api/orders") {
      const session = getSession(request);
      if (!session || session.user.role !== "customer") {
        jsonResponse(response, 401, { error: "Sign in before placing an order. Your bag will stay saved." });
        return;
      }
      const paymentDetails = getPaymentDetails();
      const body = await readRequestBody(request);
      const quote = await createOrderQuote(body);
      const recipientName = typeof body.name === "string" ? body.name.trim() : "";
      const recipientPhone = typeof body.phone === "string" ? body.phone.trim() : "";
      const shippingAddress = typeof body.address === "string" ? body.address.trim() : "";
      const phoneDigits = recipientPhone.replace(/\D/g, "");
      if (!recipientName || recipientName.length > 80) {
        throw Object.assign(new Error("Enter a recipient name up to 80 characters."), { status: 400 });
      }
      if (!/^\+?[\d\s()-]+$/.test(recipientPhone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
        throw Object.assign(new Error("Enter a valid delivery phone number with 7 to 15 digits."), { status: 400 });
      }
      const order = {
        id: crypto.randomUUID(),
        userId: session.user.id,
        createdAt: new Date().toISOString(),
        status: "pending_payment",
        paymentStatus: "Awaiting payment",
        paymentDetails,
        recipientName,
        recipientPhone,
        shippingAddress,
        ...quote
      };
      await mutateStore("orders.json", [], orders => {
        orders.push(order);
      });
      const itemSummary = order.items.map(item => `${item.quantity} × ${item.name}: ${emailCurrency(item.price * item.quantity)}`);
      await notifyCustomer("order placed", {
        recipientEmail: session.user.email,
        recipientName: recipientName,
        subject: `We received your order ${order.id.slice(0, 8)}`,
        title: "Your order has been received",
        items: order.items,
        paragraphs: [
          `Thank you for your order. Your order number is ${order.id}.`,
          ...itemSummary,
          `Delivery address: ${shippingAddress}`,
          `Order total: ${emailCurrency(order.total)}.`,
          "We will email you when your order status changes."
        ]
      });
      jsonResponse(response, 201, { order, paymentDetails });
      return;
    }

    if (route === "GET /api/auth/session") {
      const session = getSession(request);
      jsonResponse(response, 200, { user: userDetails(session) });
      return;
    }

    if (route === "GET /api/auth/avatar") {
      const session = getSession(request);
      if (!session || session.user.role !== "customer") {
        jsonResponse(response, 401, { error: "Sign in to view this profile photo." });
        return;
      }
      if (!session.user.avatarFile || !session.user.avatarType) {
        jsonResponse(response, 404, { error: "No profile photo was uploaded." });
        return;
      }
      const filename = path.basename(session.user.avatarFile);
      const image = await fs.readFile(path.join(dataDirectory, "uploads", filename));
      response.writeHead(200, {
        "Content-Type": session.user.avatarType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox"
      });
      response.end(image);
      return;
    }

    if (route === "POST /api/auth/register") {
      const body = await readRequestBody(request, 3 * 1024 * 1024);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw Object.assign(new Error("Registration details must be sent as an object."), { status: 400 });
      }
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      const address = typeof body.address === "string" ? body.address.trim() : "";
      const avatar = validateAvatar(body.avatar);
      if (!name || name.length > 80) throw Object.assign(new Error("Enter your name (up to 80 characters)."), { status: 400 });
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
      }
      if (password.length < 8 || password.length > 128) {
        throw Object.assign(new Error("Your password must be between 8 and 128 characters."), { status: 400 });
      }
      const phoneDigits = phone.replace(/\D/g, "");
      if (!/^\+?[\d\s()-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
        throw Object.assign(new Error("Enter a valid phone number with 7 to 15 digits."), { status: 400 });
      }
      if (address.length < 5 || address.length > 300) {
        throw Object.assign(new Error("Enter a delivery address between 5 and 300 characters."), { status: 400 });
      }

      const salt = crypto.randomBytes(16);
      const passwordHash = (await scrypt(password, salt, 64)).toString("hex");
      const user = await mutateStore("users.json", [], async users => {
        if (users.some(existing => existing.email === email)) {
          throw Object.assign(new Error("An account with that email already exists."), { status: 409 });
        }
        let avatarFile = null;
        if (avatar) {
          avatarFile = `${crypto.randomUUID()}${avatar.extension}`;
          const uploadDirectory = path.join(dataDirectory, "uploads");
          await fs.mkdir(uploadDirectory, { recursive: true });
          await fs.writeFile(path.join(uploadDirectory, avatarFile), avatar.buffer, { flag: "wx", mode: 0o600 });
        }
        const created = {
          id: crypto.randomUUID(),
          name,
          email,
          phone,
          address,
          avatarFile,
          avatarType: avatar ? avatar.contentType : null,
          salt: salt.toString("hex"),
          passwordHash
        };
        users.push(created);
        return { ...created, role: "customer" };
      });
      await createSession(response, request, user);
      await notifyCustomer("welcome", {
        recipientEmail: user.email,
        recipientName: user.name,
        subject: "Welcome to A&M Gadget",
        title: "Welcome to A&M Gadget",
        paragraphs: [
          "Your account has been created successfully.",
          "You can now sign in to manage your account and view your orders."
        ]
      });
      jsonResponse(response, 201, { user: userDetails({ user }) });
      return;
    }

    if (route === "POST /api/auth/login") {
      const body = await readRequestBody(request);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const users = await readStore("users.json", []);
      const existing = users.find(user => user.email === email);
      const candidate = existing
        ? (await scrypt(password, Buffer.from(existing.salt, "hex"), 64)).toString("hex")
        : "";
      if (!existing || !safeEqual(candidate, existing.passwordHash)) {
        jsonResponse(response, 401, { error: "Email or password is incorrect." });
        return;
      }
      const user = { ...existing, role: "customer" };
      await createSession(response, request, user);
      jsonResponse(response, 200, { user: userDetails({ user }) });
      return;
    }

    if (route === "POST /api/admin/login") {
      if (!adminEmail || !adminPassword) {
        jsonResponse(response, 503, { error: "Admin login is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD before starting the server." });
        return;
      }
      const body = await readRequestBody(request);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!safeEqual(email, adminEmail) || !safeEqual(password, adminPassword)) {
        jsonResponse(response, 401, { error: "Email or password is incorrect." });
        return;
      }
      const user = { id: "admin", name: "Store admin", email: adminEmail, role: "admin" };
      await createSession(response, request, user);
      jsonResponse(response, 200, { user });
      return;
    }

    if (route === "POST /api/auth/logout") {
      const token = readCookies(request).sid;
      if (token && sessions.delete(sessionTokenHash(token))) await persistSessions();
      response.setHeader("Set-Cookie", `sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${request.socket.encrypted ? "; Secure" : ""}`);
      jsonResponse(response, 200, { user: null });
      return;
    }

    if (route === "POST /api/admin/products") {
      const session = getSession(request);
      if (!session || session.user.role !== "admin") {
        jsonResponse(response, 403, { error: "Sign in as the store admin to add products." });
        return;
      }
      const product = validateProduct(await readRequestBody(request));
      const created = await mutateStore("products.json", defaultProducts, products => {
        products.push(product);
        return product;
      });
      jsonResponse(response, 201, created);
      return;
    }

    const productRoute = route.match(/^(PUT|DELETE) \/api\/admin\/products\/([^/]+)$/);
    if (productRoute) {
      const session = getSession(request);
      if (!session || session.user.role !== "admin") {
        jsonResponse(response, 403, { error: "Sign in as the store admin to manage products." });
        return;
      }
      let productId;
      try {
        productId = decodeURIComponent(productRoute[2]);
      } catch {
        jsonResponse(response, 400, { error: "The product ID is invalid." });
        return;
      }
      const result = await mutateStore("products.json", defaultProducts, async products => {
        const index = products.findIndex(product => product.id === productId);
        if (index < 0) throw Object.assign(new Error("Product not found."), { status: 404 });
        if (productRoute[1] === "DELETE") return products.splice(index, 1)[0];
        const updated = validateProduct(await readRequestBody(request));
        updated.id = productId;
        products[index] = updated;
        return updated;
      });
      jsonResponse(response, 200, result);
      return;
    }

    jsonResponse(response, 404, { error: "API endpoint not found." });
  }

  async function staticFile(request, response, url) {
    let requestedPath;
    try {
      requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    } catch {
      response.writeHead(400).end("Invalid URL path.");
      return;
    }

    const filePath = path.resolve(publicDirectory, `.${requestedPath}`);
    const relativePath = path.relative(publicDirectory, filePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath) ||
        relativePath.toLowerCase() === "server.js" ||
        relativePath.toLowerCase().startsWith(`data${path.sep}`) ||
        path.basename(relativePath).startsWith(".")) {
      response.writeHead(404).end("Not found.");
      return;
    }

    const contentType = contentTypes[path.extname(filePath).toLowerCase()];
    if (!contentType || (request.method !== "GET" && request.method !== "HEAD")) {
      response.writeHead(404).end("Not found.");
      return;
    }

    try {
      const contents = await fs.readFile(filePath);
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
      response.writeHead(404).end("Not found.");
    }
  }

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        await loadSessions();
        await api(request, response, url);
      } else {
        await staticFile(request, response, url);
      }
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      if (!error.status || error.status >= 500) console.error(error);
      jsonResponse(response, error.status || 500, {
        error: error.status ? error.message : "The server could not complete the request."
      });
    }
  });
}

if (require.main === module) {
  loadEnvironmentFile().then(() => {
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || "127.0.0.1";
    const server = createServer();
    server.on("error", error => {
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use. The store may already be running at http://${host}:${port}.`);
      } else {
        console.error("Could not start the store server:", error);
      }
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      console.log(`A&M Gadget is running at http://${host}:${port}`);
      if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
        console.warn("Admin login is disabled until ADMIN_EMAIL and ADMIN_PASSWORD are configured.");
      }
      if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
        console.warn("Transactional email is disabled until BREVO_API_KEY and BREVO_SENDER_EMAIL are configured.");
      }
    });
  }).catch(error => {
    console.error("Could not load server configuration:", error);
    process.exitCode = 1;
  });
}

module.exports = { createServer };
