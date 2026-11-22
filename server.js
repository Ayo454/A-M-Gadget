const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");
const { SupabaseStore } = require("./supabase-store");

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
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp"
};
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; manifest-src 'self'; worker-src 'self'"
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

function isoWeekKey(value = new Date()) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - (firstThursday.getUTCDay() || 7));
  const week = 1 + Math.round((date - firstThursday) / 604800000);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function normalizeSmsPhone(value) {
  const phone = String(value || "").trim();
  const digits = phone.replace(/\D/g, "");
  if (/^0\d{10}$/.test(digits)) return `234${digits.slice(1)}`;
  if (/^234\d{10}$/.test(digits)) return digits;
  if (phone.startsWith("+") && digits.length >= 8 && digits.length <= 15) return digits;
  throw Object.assign(new Error("The delivery phone number must include its international country code."), { status: 400 });
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
  const supabaseUrl = String(options.supabaseUrl ?? process.env.SUPABASE_URL ?? "").trim();
  const supabaseServiceRoleKey = String(options.supabaseServiceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!options.supabaseStore && Boolean(supabaseUrl) !== Boolean(supabaseServiceRoleKey)) {
    throw new Error("Configure both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable Supabase storage.");
  }
  const supabaseStore = options.supabaseStore || (supabaseUrl
    ? new SupabaseStore({
      url: supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      fetchImpl: options.supabaseFetch || globalThis.fetch
    })
    : null);
  const adminEmail = String(options.adminEmail ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const adminPassword = String(options.adminPassword ?? process.env.ADMIN_PASSWORD ?? "");
  const orderNotificationEmail = String(options.orderNotificationEmail ?? process.env.ORDER_NOTIFICATION_EMAIL ?? "").trim().toLowerCase() || adminEmail;
  const orderNotificationPhones = [...new Set(String(options.orderNotificationPhones ?? process.env.ORDER_NOTIFICATION_PHONES ?? "")
    .split(",")
    .map(phone => phone.trim())
    .filter(Boolean))];
  const secureCookies = options.secureCookies ?? (process.env.NODE_ENV === "production");
  const brevoApiKey = String(options.brevoApiKey ?? process.env.BREVO_API_KEY ?? "").trim();
  const brevoSenderEmail = String(options.brevoSenderEmail ?? process.env.BREVO_SENDER_EMAIL ?? "").trim();
  const brevoSenderName = String(options.brevoSenderName ?? process.env.BREVO_SENDER_NAME ?? "A&M Gadget").trim();
  const brevoSmsSender = String(options.brevoSmsSender ?? process.env.BREVO_SMS_SENDER ?? "").trim();
  const brevoOAuthClientId = String(options.brevoOAuthClientId ?? process.env.BREVO_OAUTH_CLIENT_ID ?? "").trim();
  const brevoOAuthClientSecret = String(options.brevoOAuthClientSecret ?? process.env.BREVO_OAUTH_CLIENT_SECRET ?? "").trim();
  const deliveryOtpSecret = String(options.deliveryOtpSecret ?? process.env.DELIVERY_OTP_SECRET ?? "").trim();
  const brevoFetch = options.brevoFetch || globalThis.fetch;
  let brevoSmsToken = "";
  let brevoSmsTokenExpiresAt = 0;
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
  const loginFailures = new Map();
  const loginFailureLimit = 10;
  const loginFailureWindowMs = 15 * 60 * 1000;
  let writeQueue = Promise.resolve();
  let sessionsLoadPromise;

  function loginFailureKey(email) {
    return crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");
  }

  function loginRetryAfter(email) {
    const key = loginFailureKey(email);
    const record = loginFailures.get(key);
    if (!record) return 0;
    if (record.resetAt <= Date.now()) {
      loginFailures.delete(key);
      return 0;
    }
    return record.count >= loginFailureLimit
      ? Math.ceil((record.resetAt - Date.now()) / 1000)
      : 0;
  }

  function recordLoginFailure(email) {
    const now = Date.now();
    const key = loginFailureKey(email);
    let record = loginFailures.get(key);
    if (!record || record.resetAt <= now) {
      record = { count: 0, resetAt: now + loginFailureWindowMs };
    }
    record.count += 1;
    loginFailures.delete(key);
    loginFailures.set(key, record);
    if (loginFailures.size > 10000) {
      for (const [trackedKey, trackedRecord] of loginFailures) {
        if (trackedRecord.resetAt <= now) loginFailures.delete(trackedKey);
      }
      while (loginFailures.size > 10000) loginFailures.delete(loginFailures.keys().next().value);
    }
  }

  function clearLoginFailures(email) {
    loginFailures.delete(loginFailureKey(email));
  }

  function rejectIfLoginLimited(response, email) {
    const retryAfter = loginRetryAfter(email);
    if (!retryAfter) return false;
    jsonResponse(response, 429, { error: "Too many failed sign-in attempts. Try again later." }, {
      "Retry-After": String(retryAfter)
    });
    return true;
  }

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

  async function getBrevoSmsToken() {
    if (brevoSmsToken && brevoSmsTokenExpiresAt > Date.now() + 30000) return brevoSmsToken;
    if (!brevoOAuthClientId || !brevoOAuthClientSecret) {
      throw new Error("Configure BREVO_OAUTH_CLIENT_ID and BREVO_OAUTH_CLIENT_SECRET to send delivery SMS.");
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: brevoOAuthClientId,
      client_secret: brevoOAuthClientSecret,
      scope: "transactional.sms:write"
    });
    const response = await brevoFetch("https://api.brevo.com/realms/partner/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!response.ok) throw new Error(`Brevo OAuth returned HTTP ${response.status} while requesting an SMS token.`);
    const tokenResult = await response.json();
    if (!tokenResult || typeof tokenResult.access_token !== "string" ||
        !Number.isFinite(Number(tokenResult.expires_in)) || Number(tokenResult.expires_in) <= 0) {
      throw new Error("Brevo returned an invalid SMS authorization token.");
    }
    brevoSmsToken = tokenResult.access_token;
    brevoSmsTokenExpiresAt = Date.now() + Number(tokenResult.expires_in) * 1000;
    return brevoSmsToken;
  }

  async function sendBrevoSms({ recipientPhone, content }) {
    const validSmsSender = /^\d{1,15}$/.test(brevoSmsSender) || /^[A-Za-z0-9]{1,11}$/.test(brevoSmsSender);
    if (!brevoSmsSender || !validSmsSender) {
      throw new Error("Configure a valid BREVO_SMS_SENDER (up to 11 alphanumeric or 15 numeric characters) to send delivery SMS.");
    }
    const recipient = normalizeSmsPhone(recipientPhone);
    const token = await getBrevoSmsToken();
    const response = await brevoFetch("https://api.brevo.com/v3/transactionalSMS/send", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "authorization": `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ sender: brevoSmsSender, recipient, content, type: "transactional" })
    });
    if (!response.ok) throw new Error(`Brevo returned HTTP ${response.status} while sending SMS.`);
  }

  async function notifyCustomer(eventName, email) {
    try {
      await sendBrevoEmail(email);
    } catch (error) {
      console.error(`Could not send Brevo ${eventName} email:`, error.message);
    }
  }

  async function notifyStoreContacts(eventName, { subject, title, paragraphs, items = [], smsContent }) {
    const notifications = [];
    if (orderNotificationEmail) {
      notifications.push(notifyCustomer(eventName, {
        recipientEmail: orderNotificationEmail,
        recipientName: "Store admin",
        subject,
        title,
        items,
        paragraphs
      }));
    }
    orderNotificationPhones.forEach((recipientPhone, index) => {
      notifications.push(sendBrevoSms({
        recipientPhone,
        content: String(smsContent).replace(/\s+/g, " ").trim().slice(0, 160)
      }).catch(error => {
        console.error(`Could not send ${eventName} SMS #${index + 1}:`, error.message);
      }));
    });
    await Promise.all(notifications);
  }

  async function notifyStoreOfOrder(order) {
    const orderNumber = order.id.slice(0, 8);
    await notifyStoreContacts("new order", {
      subject: `New order received: ${orderNumber}`,
      title: "A new order has been placed",
      items: order.items,
      paragraphs: [
        `Order number: ${order.id}.`,
        `Customer: ${order.recipientName}.`,
        `Phone: ${order.recipientPhone}.`,
        `Delivery address: ${order.shippingAddress}.`,
        `Payment status: ${order.paymentStatus}.`,
        `Order total: ${emailCurrency(order.total)}.`
      ],
      smsContent: `New A&M Gadget order ${orderNumber}. Total ${emailCurrency(order.total)}. Check the admin dashboard for details.`
    });
  }

  async function notifyStoreOfDelivery(order, deliveredBy) {
    const orderNumber = order.id.slice(0, 8);
    const riderName = String(deliveredBy || "Assigned rider").replace(/\s+/g, " ").trim();
    await notifyStoreContacts("order delivered", {
      subject: `Order delivered by ${riderName}: ${orderNumber}`,
      title: "An order has been delivered",
      items: order.items,
      paragraphs: [
        `Order number: ${order.id}.`,
        `Delivered by: ${riderName}.`,
        `Customer: ${order.recipientName}.`,
        `Delivered at: ${order.deliveredAt || order.updatedAt}.`,
        `Order total: ${emailCurrency(order.total)}.`,
        `Rider commission: ${emailCurrency(order.riderCommission || 0)}.`
      ],
      smsContent: `Order ${orderNumber} delivered by ${riderName}. Total ${emailCurrency(order.total)}.`
    });
  }

  async function notifyStoreOfPayout(payout, riderName) {
    const safeRiderName = String(riderName || "Rider").replace(/\s+/g, " ").trim();
    await notifyStoreContacts("rider payout request", {
      subject: `Payout request from ${safeRiderName}: ${emailCurrency(payout.amount)}`,
      title: "Rider payout request",
      paragraphs: [
        `Rider: ${safeRiderName}.`,
        `Amount requested: ${emailCurrency(payout.amount)}.`,
        `Earnings week: ${payout.weekKey}.`,
        "Review the rider's bank details in the admin dashboard."
      ],
      smsContent: `Payout request from ${safeRiderName}: ${emailCurrency(payout.amount)} for ${payout.weekKey}. Review the admin dashboard.`
    });
  }

  async function notifyOrderStatusChanged(order, deliveredBy = "") {
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
      const paragraphs = [
        `Order ${order.id} is now ${status}.`,
        `Payment status: ${order.paymentStatus || "Awaiting payment"}.`,
        `Order total: ${emailCurrency(order.total)}.`
      ];
      if (order.status === "delivered" && deliveredBy) paragraphs.push(`Delivered by: ${deliveredBy}.`);
      await notifyCustomer("order status", {
        recipientEmail: customer.email,
        recipientName: customer.name,
        subject: `Order ${order.id.slice(0, 8)} update: ${status}`,
        title: "Your order has been updated",
        items: order.items,
        paragraphs
      });
    } catch (error) {
      console.error("Could not prepare the Brevo order status email:", error.message);
    }
  }

  async function notifyRiderAssignment(order, rider) {
    await notifyCustomer("rider assignment", {
      recipientEmail: rider.email,
      recipientName: rider.name,
      subject: `New delivery assigned: ${order.id.slice(0, 8)}`,
      title: "A delivery has been assigned to you",
      paragraphs: [
        `Order ${order.id} is ready for delivery.`,
        `Recipient: ${order.recipientName || "Customer"}.`,
        `Delivery phone: ${order.recipientPhone || "Not provided"}.`,
        `Delivery address: ${order.shippingAddress}.`,
        "Sign in to your rider dashboard to start the delivery."
      ]
    });
  }

  async function readStore(name, initialValue) {
    if (supabaseStore) {
      const collection = path.basename(name, ".json");
      const records = await supabaseStore.getCollection(collection);
      if (records !== null) return records;
      const initialRecords = JSON.parse(JSON.stringify(initialValue));
      await supabaseStore.setCollection(collection, initialRecords);
      return initialRecords;
    }
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

  async function writeStore(name, records) {
    if (supabaseStore) {
      const collection = path.basename(name, ".json");
      await supabaseStore.setCollection(collection, records);
      return;
    }
    await fs.writeFile(path.join(dataDirectory, name), `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
  }

  async function mutateStore(name, initialValue, update) {
    const operation = writeQueue.then(async () => {
      const store = await readStore(name, initialValue);
      const result = await update(store);
      await writeStore(name, store);
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
        if (supabaseStore) {
          records = await readStore("sessions.json", []);
        } else {
          try {
            records = JSON.parse(await fs.readFile(path.join(dataDirectory, "sessions.json"), "utf8"));
          } catch (error) {
            if (error.code === "ENOENT") return;
            throw error;
          }
        }
        if (!Array.isArray(records)) throw new Error("The stored sessions file is invalid.");
        records.forEach(record => {
          const user = record && record.user;
          if (!record || typeof record.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(record.tokenHash) ||
              !user || typeof user.id !== "string" || typeof user.email !== "string" ||
              typeof user.name !== "string" || !["admin", "customer", "rider"].includes(user.role)) {
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
        if (supabaseStore) {
          await supabaseStore.setCollection("sessions", records);
        } else {
          await fs.writeFile(temporaryFile, `${JSON.stringify(records, null, 2)}\n`, { flag: "wx", mode: 0o600 });
          await fs.rename(temporaryFile, sessionFile);
        }
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
    const secure = request.socket.encrypted || secureCookies ? "; Secure" : "";
    return `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionCookieLifetime}${secure}`;
  }

  function expiredSessionCookie(request) {
    const secure = request.socket.encrypted || secureCookies ? "; Secure" : "";
    return `sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
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
      avatarUrl: user.avatarFile ? "/api/auth/avatar" : null,
      vehicleType: user.vehicleType || ""
    };
  }

  async function api(request, response, url) {
    const route = `${request.method} ${url.pathname}`;

    if (route === "GET /api/products") {
      jsonResponse(response, 200, await readStore("products.json", defaultProducts));
      return;
    }

    if (route === "GET /api/admin/riders") {
      const session = getSession(request);
      if (!session || session.user.role !== "admin") {
        jsonResponse(response, 403, { error: "Sign in as the store admin to view riders." });
        return;
      }
      const riders = await readStore("riders.json", []);
      jsonResponse(response, 200, riders.map(rider => ({
        id: rider.id,
        name: rider.name,
        email: rider.email,
        phone: rider.phone,
        vehicleType: rider.vehicleType,
        licensePlate: rider.licensePlate,
        bankName: rider.bankName,
        accountName: rider.accountName,
        accountNumber: rider.accountNumber,
        status: rider.status,
        createdAt: rider.createdAt,
        approvedAt: rider.approvedAt || null
      })));
      return;
    }

    const adminRiderMatch = url.pathname.match(/^\/api\/admin\/riders\/([^/]+)$/);
    if (request.method === "PATCH" && adminRiderMatch) {
      const session = getSession(request);
      if (!session || session.user.role !== "admin") {
        jsonResponse(response, 403, { error: "Sign in as the store admin to update riders." });
        return;
      }
      const body = await readRequestBody(request);
      if (!body || !["approve", "reject"].includes(body.action)) {
        throw Object.assign(new Error("Choose approve or reject for this rider."), { status: 400 });
      }
      let riderId;
      try {
        riderId = decodeURIComponent(adminRiderMatch[1]);
      } catch {
        throw Object.assign(new Error("The rider ID is invalid."), { status: 400 });
      }
      const rider = await mutateStore("riders.json", [], riders => {
        const selected = riders.find(item => item.id === riderId);
        if (!selected) throw Object.assign(new Error("Rider not found."), { status: 404 });
        if (selected.status !== "pending") {
          throw Object.assign(new Error("Only pending rider applications can be reviewed."), { status: 409 });
        }
        selected.status = body.action === "approve" ? "active" : "rejected";
        selected.reviewedAt = new Date().toISOString();
        if (body.action === "approve") selected.approvedAt = selected.reviewedAt;
        return { ...selected };
      });
      await notifyCustomer(`rider ${body.action}`, {
        recipientEmail: rider.email,
        recipientName: rider.name,
        subject: body.action === "approve" ? "Your A&M Gadget rider application is approved" : "Update on your A&M Gadget rider application",
        title: body.action === "approve" ? "Welcome to the rider team" : "Rider application update",
        paragraphs: body.action === "approve"
          ? ["Your rider application has been approved.", "Sign in to the rider portal to view assigned deliveries and manage your earnings."]
          : ["Your rider application was not approved at this time.", "Contact the store if you have questions."]
      });
      jsonResponse(response, 200, { rider: { id: rider.id, status: rider.status } });
      return;
    }

    if (route === "GET /api/admin/payout-requests") {
      const session = getSession(request);
      if (!session || session.user.role !== "admin") {
        jsonResponse(response, 403, { error: "Sign in as the store admin to view payout requests." });
        return;
      }
      const [requests, riders] = await Promise.all([
        readStore("payout_requests.json", []),
        readStore("riders.json", [])
      ]);
      const ridersById = new Map(riders.map(rider => [rider.id, rider]));
      jsonResponse(response, 200, requests.map(request => {
        const rider = ridersById.get(request.riderId);
        return {
          ...request,
          riderName: rider ? rider.name : "Rider account unavailable",
          riderEmail: rider ? rider.email : "",
          bankName: request.bankName || (rider && rider.bankName) || "",
          accountName: request.accountName || (rider && rider.accountName) || "",
          accountNumber: request.accountNumber || (rider && rider.accountNumber) || ""
        };
      }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)));
      return;
    }

    const adminPayoutMatch = url.pathname.match(/^\/api\/admin\/payout-requests\/([^/]+)$/);
    if (request.method === "PATCH" && adminPayoutMatch) {
      const session = getSession(request);
      if (!session || session.user.role !== "admin") {
        jsonResponse(response, 403, { error: "Sign in as the store admin to update payout requests." });
        return;
      }
      const body = await readRequestBody(request);
      if (!body || !["mark_paid", "reject"].includes(body.action)) {
        throw Object.assign(new Error("Choose mark_paid or reject for this payout request."), { status: 400 });
      }
      let payoutId;
      try {
        payoutId = decodeURIComponent(adminPayoutMatch[1]);
      } catch {
        throw Object.assign(new Error("The payout request ID is invalid."), { status: 400 });
      }
      const payout = await mutateStore("payout_requests.json", [], requests => {
        const selected = requests.find(item => item.id === payoutId);
        if (!selected) throw Object.assign(new Error("Payout request not found."), { status: 404 });
        if (selected.status !== "pending") {
          throw Object.assign(new Error("Only pending payout requests can be reviewed."), { status: 409 });
        }
        selected.status = body.action === "mark_paid" ? "paid" : "rejected";
        selected.reviewedAt = new Date().toISOString();
        selected.reviewedBy = session.user.id;
        return { ...selected };
      });
      const riders = await readStore("riders.json", []);
      const rider = riders.find(item => item.id === payout.riderId);
      if (rider) {
        await notifyCustomer(`rider payout ${payout.status}`, {
          recipientEmail: rider.email,
          recipientName: rider.name,
          subject: `Your rider payout request was ${payout.status === "paid" ? "paid" : "rejected"}`,
          title: payout.status === "paid" ? "Payout marked as paid" : "Payout request update",
          paragraphs: payout.status === "paid"
            ? [`Your payout request for ${emailCurrency(payout.amount)} (${payout.weekKey}) has been marked as paid.`, "Thank you for delivering with A&M Gadget."]
            : [`Your payout request for ${emailCurrency(payout.amount)} (${payout.weekKey}) was rejected.`, "Contact the store admin if you need more information."]
        });
      }
      jsonResponse(response, 200, { payoutRequest: { id: payout.id, status: payout.status } });
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
        confirm_payment: { from: "payment_reported", to: "confirmed" }
      };
      if (typeof action !== "string" || (!transitions[action] && !["mark_shipping", "cancel"].includes(action))) {
        throw Object.assign(new Error("Choose a valid order action."), { status: 400 });
      }
      const orderId = decodeURIComponent(adminOrderActionMatch[1]);
      let assignedRider = null;
      if (action === "mark_shipping") {
        const riderId = typeof body.riderId === "string" ? body.riderId : "";
        const riders = await readStore("riders.json", []);
        assignedRider = riders.find(rider => rider.id === riderId && rider.status === "active");
        if (!assignedRider) {
          throw Object.assign(new Error("Select an approved rider before assigning this delivery."), { status: 400 });
        }
      }
      const order = await mutateStore("orders.json", [], orders => {
        const selectedOrder = orders.find(item => item.id === orderId);
        if (!selectedOrder) throw Object.assign(new Error("Order not found."), { status: 404 });
        const currentStatus = selectedOrder.status || "pending_payment";
        const transition = transitions[action];
        const assigningRider = action === "mark_shipping" && currentStatus === "confirmed";
        const canCancel = action === "cancel" &&
          ["pending_payment", "payment_reported", "confirmed", "shipping", "in_transit"].includes(currentStatus);
        if (!canCancel && !assigningRider && (!transition || currentStatus !== transition.from)) {
          throw Object.assign(new Error("That action is not available for the current order status."), { status: 409 });
        }
        selectedOrder.status = canCancel ? "cancelled" : assigningRider ? "shipping" : transition.to;
        if (assigningRider) {
          selectedOrder.riderId = assignedRider.id;
          selectedOrder.riderAssignedAt = new Date().toISOString();
        }
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
      if (assignedRider) await notifyRiderAssignment(order, assignedRider);
      jsonResponse(response, 200, {
        order: {
          id: order.id,
          status: order.status,
          paymentStatus: order.paymentStatus,
          updatedAt: order.updatedAt,
          riderId: order.riderId || null,
          riderName: assignedRider ? assignedRider.name : "",
          riderEmail: assignedRider ? assignedRider.email : ""
        }
      });
      return;
    }

    if (route === "GET /api/admin/orders") {
      const session = getSession(request);
      if (!session || session.user.role !== "admin") {
        jsonResponse(response, 403, { error: "Sign in as the store admin to view orders." });
        return;
      }
      const [orders, users, products, riders] = await Promise.all([
        readStore("orders.json", []),
        readStore("users.json", []),
        readStore("products.json", defaultProducts),
        readStore("riders.json", [])
      ]);
      const usersById = new Map(users.map(user => [user.id, user]));
      const productsById = new Map(products.map(product => [product.id, product]));
      const ridersById = new Map(riders.map(rider => [rider.id, rider]));
      const adminOrders = orders.map(order => {
        const customer = usersById.get(order.userId);
        const rider = ridersById.get(order.riderId);
        return {
          id: order.id,
          customerName: order.recipientName || (customer ? customer.name : "Customer account unavailable"),
          customerEmail: customer ? customer.email : "",
          customerPhone: order.recipientPhone || (customer ? customer.phone || "" : ""),
          createdAt: order.createdAt,
          updatedAt: order.updatedAt || null,
          status: order.status || "pending_payment",
          riderId: order.riderId || null,
          riderName: rider ? rider.name : "",
          riderEmail: rider ? rider.email : "",
          riderCommission: order.riderCommission ?? null,
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
      const customerOrders = orders.filter(order => order.userId === session.user.id).map(order => {
        const {
          deliveryCodeHash,
          deliveryCodeExpiresAt,
          deliveryCodeRequestedAt,
          deliveryCodeAttempts,
          riderId,
          riderCommission,
          ...customerOrder
        } = order;
        return customerOrder;
      });
      jsonResponse(response, 200, customerOrders);
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
      await Promise.all([
        notifyCustomer("order placed", {
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
        }),
        notifyStoreOfOrder(order)
      ]);
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
      let image;
      if (supabaseStore) {
        const avatar = await supabaseStore.downloadAvatar(session.user.avatarFile);
        image = avatar.buffer;
      } else {
        const filename = path.basename(session.user.avatarFile);
        image = await fs.readFile(path.join(dataDirectory, "uploads", filename));
      }
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
        const riders = await readStore("riders.json", []);
        if (users.some(existing => existing.email === email) ||
            riders.some(existing => existing.email === email) || email === adminEmail) {
          throw Object.assign(new Error("An account with that email already exists."), { status: 409 });
        }
        const id = crypto.randomUUID();
        let avatarFile = null;
        if (avatar) {
          if (supabaseStore) {
            avatarFile = `${id}/${crypto.randomUUID()}${avatar.extension}`;
            await supabaseStore.uploadAvatar(avatarFile, avatar.buffer, avatar.contentType);
          } else {
            avatarFile = `${crypto.randomUUID()}${avatar.extension}`;
            const uploadDirectory = path.join(dataDirectory, "uploads");
            await fs.mkdir(uploadDirectory, { recursive: true });
            await fs.writeFile(path.join(uploadDirectory, avatarFile), avatar.buffer, { flag: "wx", mode: 0o600 });
          }
        }
        const created = {
          id,
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
      if (rejectIfLoginLimited(response, email)) return;
      const users = await readStore("users.json", []);
      const existing = users.find(user => user.email === email);
      const candidate = existing
        ? (await scrypt(password, Buffer.from(existing.salt, "hex"), 64)).toString("hex")
        : "";
      if (!existing || !safeEqual(candidate, existing.passwordHash)) {
        recordLoginFailure(email);
        jsonResponse(response, 401, { error: "Email or password is incorrect." });
        return;
      }
      clearLoginFailures(email);
      const user = { ...existing, role: "customer" };
      await createSession(response, request, user);
      jsonResponse(response, 200, { user: userDetails({ user }) });
      return;
    }

    if (route === "POST /api/rider/register") {
      const body = await readRequestBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw Object.assign(new Error("Rider registration details must be sent as an object."), { status: 400 });
      }
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const vehicleType = typeof body.vehicleType === "string" ? body.vehicleType.trim() : "";
      const licensePlate = typeof body.licensePlate === "string" ? body.licensePlate.trim().toUpperCase() : "";
      const bankName = typeof body.bankName === "string" ? body.bankName.trim() : "";
      const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";
      const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.replace(/\s/g, "") : "";
      const phoneDigits = phone.replace(/\D/g, "");
      if (!name || name.length > 80) throw Object.assign(new Error("Enter your name (up to 80 characters)."), { status: 400 });
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
      }
      if (!/^\+?[\d\s()-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
        throw Object.assign(new Error("Enter a valid phone number with 7 to 15 digits."), { status: 400 });
      }
      if (password.length < 8 || password.length > 128) {
        throw Object.assign(new Error("Your password must be between 8 and 128 characters."), { status: 400 });
      }
      if (!["Motorcycle", "Car", "Bicycle", "Other"].includes(vehicleType)) {
        throw Object.assign(new Error("Choose a supported vehicle type."), { status: 400 });
      }
      if (licensePlate.length > 20) throw Object.assign(new Error("Vehicle registration must be 20 characters or fewer."), { status: 400 });
      if (!bankName || bankName.length > 80 || !accountName || accountName.length > 80 ||
          !/^\d{10}$/.test(accountNumber)) {
        throw Object.assign(new Error("Enter a bank name, account name, and valid 10-digit account number for weekly payouts."), { status: 400 });
      }
      const salt = crypto.randomBytes(16);
      const passwordHash = (await scrypt(password, salt, 64)).toString("hex");
      const rider = await mutateStore("riders.json", [], async riders => {
        const users = await readStore("users.json", []);
        if (email === adminEmail || users.some(user => user.email === email) ||
            riders.some(existing => existing.email === email)) {
          throw Object.assign(new Error("An account with that email already exists."), { status: 409 });
        }
        const created = {
          id: crypto.randomUUID(),
          name,
          email,
          phone,
          vehicleType,
          licensePlate,
          bankName,
          accountName,
          accountNumber,
          status: "pending",
          createdAt: new Date().toISOString(),
          salt: salt.toString("hex"),
          passwordHash
        };
        riders.push(created);
        return { ...created };
      });
      await Promise.all([
        notifyCustomer("rider application confirmation", {
          recipientEmail: rider.email,
          recipientName: rider.name,
          subject: "We received your A&M Gadget rider application",
          title: "Application received",
          paragraphs: [
            "Thank you for applying to ride with A&M Gadget.",
            "Your application is waiting for admin approval. We will email you when it has been reviewed."
          ]
        }),
        adminEmail ? notifyCustomer("new rider application alert", {
          recipientEmail: adminEmail,
          recipientName: "Store admin",
          subject: `New rider application from ${rider.name}`,
          title: "Rider application needs review",
          paragraphs: [
            `${rider.name} (${rider.email}) has applied to become a delivery rider.`,
            `Phone: ${rider.phone}. Vehicle: ${rider.vehicleType}${rider.licensePlate ? ` (${rider.licensePlate})` : ""}.`,
            "Sign in to the admin dashboard and review the Riders section."
          ]
        }) : Promise.resolve()
      ]);
      jsonResponse(response, 201, { status: rider.status, message: "Application received. Sign in after the admin approves your rider account." });
      return;
    }

    if (route === "POST /api/rider/login") {
      const body = await readRequestBody(request);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (rejectIfLoginLimited(response, email)) return;
      const riders = await readStore("riders.json", []);
      const existing = riders.find(rider => rider.email === email);
      const candidate = existing
        ? (await scrypt(password, Buffer.from(existing.salt, "hex"), 64)).toString("hex")
        : "";
      if (!existing || !safeEqual(candidate, existing.passwordHash)) {
        recordLoginFailure(email);
        jsonResponse(response, 401, { error: "Email or password is incorrect." });
        return;
      }
      clearLoginFailures(email);
      if (existing.status !== "active") {
        jsonResponse(response, 403, {
          error: existing.status === "rejected"
            ? "This rider application was not approved. Contact the store if you have questions."
            : "Your rider application is waiting for admin approval."
        });
        return;
      }
      const user = { ...existing, role: "rider" };
      await createSession(response, request, user);
      jsonResponse(response, 200, { user: userDetails({ user }) });
      return;
    }

    if (route === "GET /api/rider/dashboard") {
      const session = getSession(request);
      if (!session || session.user.role !== "rider") {
        jsonResponse(response, 403, { error: "Sign in to your approved rider account to view deliveries." });
        return;
      }
      const [riders, orders, payouts] = await Promise.all([
        readStore("riders.json", []),
        readStore("orders.json", []),
        readStore("payout_requests.json", [])
      ]);
      const rider = riders.find(item => item.id === session.user.id && item.status === "active");
      if (!rider) {
        jsonResponse(response, 403, { error: "This rider account is not active." });
        return;
      }
      const assignedOrders = orders.filter(order => order.riderId === rider.id).map(order => {
        const commission = order.status === "delivered"
          ? Math.round((Number(order.deliveryFee) || 0) * 0.03 * 100) / 100
          : 0;
        return {
          id: order.id,
          status: order.status || "pending_payment",
          createdAt: order.createdAt,
          recipientName: order.recipientName || "Customer",
          recipientPhone: order.recipientPhone || "",
          shippingAddress: order.shippingAddress || "",
          items: Array.isArray(order.items) ? order.items.map(item => ({
            name: item.name || "Gadget",
            quantity: Number(item.quantity) || 1
          })) : [],
          deliveryFee: Number(order.deliveryFee) || 0,
          riderCommission: commission,
          deliveredAt: order.deliveredAt || null
        };
      }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      const earned = assignedOrders.reduce((sum, order) => sum + order.riderCommission, 0);
      const riderPayouts = payouts.filter(payout => payout.riderId === rider.id);
      const committed = riderPayouts
        .filter(payout => ["pending", "paid"].includes(payout.status))
        .reduce((sum, payout) => sum + Number(payout.amount || 0), 0);
      const availableBalance = Math.max(0, Math.round((earned - committed) * 100) / 100);
      const weekKey = isoWeekKey();
      const currentWeekRequest = riderPayouts.find(payout => payout.weekKey === weekKey && payout.status !== "rejected");
      jsonResponse(response, 200, {
        rider: { name: rider.name, email: rider.email, phone: rider.phone, vehicleType: rider.vehicleType },
        orders: assignedOrders,
        payouts: riderPayouts.map(payout => ({
          id: payout.id,
          amount: Number(payout.amount) || 0,
          status: payout.status,
          weekKey: payout.weekKey,
          createdAt: payout.createdAt,
          reviewedAt: payout.reviewedAt || null
        })).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
        earnings: {
          earned: Math.round(earned * 100) / 100,
          availableBalance,
          weekKey,
          canRequestPayout: availableBalance > 0 && !currentWeekRequest,
          accountLastFour: rider.accountNumber.slice(-4)
        }
      });
      return;
    }

    const riderDeliveryMatch = url.pathname.match(/^\/api\/rider\/orders\/([^/]+)\/(start|request-code|verify-code)$/);
    if (riderDeliveryMatch && ["PATCH", "POST"].includes(request.method)) {
      const session = getSession(request);
      if (!session || session.user.role !== "rider") {
        jsonResponse(response, 403, { error: "Sign in to your approved rider account to update deliveries." });
        return;
      }
      let orderId;
      try {
        orderId = decodeURIComponent(riderDeliveryMatch[1]);
      } catch {
        throw Object.assign(new Error("The order ID is invalid."), { status: 400 });
      }
      const action = riderDeliveryMatch[2];
      if (action === "start") {
        const order = await mutateStore("orders.json", [], orders => {
          const selected = orders.find(item => item.id === orderId && item.riderId === session.user.id);
          if (!selected) throw Object.assign(new Error("Assigned order not found."), { status: 404 });
          if (selected.status !== "shipping") {
            throw Object.assign(new Error("Only assigned deliveries can be started."), { status: 409 });
          }
          selected.status = "in_transit";
          selected.deliveryStartedAt = new Date().toISOString();
          selected.updatedAt = selected.deliveryStartedAt;
          return selected;
        });
        await notifyOrderStatusChanged(order);
        jsonResponse(response, 200, { order: { id: order.id, status: order.status } });
        return;
      }

      if (action === "request-code") {
        if (!deliveryOtpSecret || deliveryOtpSecret.length < 32) {
          jsonResponse(response, 503, { error: "Delivery verification is not configured. Set a DELIVERY_OTP_SECRET of at least 32 characters." });
          return;
        }
        const [customerRecords, orderRecords] = await Promise.all([
          readStore("users.json", []),
          readStore("orders.json", [])
        ]);
        const selected = orderRecords.find(item => item.id === orderId && item.riderId === session.user.id);
        if (!selected) {
          jsonResponse(response, 404, { error: "Assigned order not found." });
          return;
        }
        if (selected.status !== "in_transit") {
          jsonResponse(response, 409, { error: "Start this delivery before requesting its confirmation code." });
          return;
        }
        const customer = customerRecords.find(item => item.id === selected.userId);
        if (!customer || !customer.email || !selected.recipientPhone) {
          jsonResponse(response, 409, { error: "This order is missing the customer's email or delivery phone number." });
          return;
        }
        normalizeSmsPhone(selected.recipientPhone);
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
        const codeHash = crypto.createHmac("sha256", deliveryOtpSecret).update(`${orderId}:${code}`).digest("hex");
        const codeRequest = await mutateStore("orders.json", [], orders => {
          const order = orders.find(item => item.id === orderId && item.riderId === session.user.id);
          if (!order || order.status !== "in_transit") {
            throw Object.assign(new Error("This delivery is no longer waiting for confirmation."), { status: 409 });
          }
          if (order.deliveryCodeRequestedAt && Date.now() - Date.parse(order.deliveryCodeRequestedAt) < 60000) {
            return { retryAfter: true };
          }
          order.deliveryCodeHash = codeHash;
          order.deliveryCodeExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
          order.deliveryCodeRequestedAt = new Date().toISOString();
          order.deliveryCodeAttempts = 0;
          return { retryAfter: false };
        });
        if (codeRequest.retryAfter) {
          jsonResponse(response, 429, { error: "A delivery code was sent recently. Wait one minute before requesting another." });
          return;
        }
        const [emailResult, smsResult] = await Promise.allSettled([
          sendBrevoEmail({
            recipientEmail: customer.email,
            recipientName: selected.recipientName || customer.name,
            subject: `Delivery confirmation code for order ${orderId.slice(0, 8)}`,
            title: "Confirm your delivery",
            paragraphs: [
              `Your delivery confirmation code is ${code}.`,
              "Give this code to your rider only when your order has arrived. It expires in 10 minutes."
            ]
          }),
          sendBrevoSms({
            recipientPhone: selected.recipientPhone,
            content: `A&M Gadget delivery code: ${code}. Share it with your rider only after receiving your order. Expires in 10 minutes.`
          })
        ]);
        if (emailResult.status === "rejected" || smsResult.status === "rejected") {
          if (emailResult.status === "rejected") console.error("Could not send the delivery code email:", emailResult.reason.message);
          if (smsResult.status === "rejected") console.error("Could not send the delivery code SMS:", smsResult.reason.message);
          jsonResponse(response, 503, { error: "We could not deliver the code by both email and SMS. Wait one minute, check the contact details, and try again." });
          return;
        }
        jsonResponse(response, 200, { message: "The confirmation code was sent to the customer's email and phone." });
        return;
      }

      const body = await readRequestBody(request);
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!/^\d{6}$/.test(code)) {
        throw Object.assign(new Error("Enter the customer's 6-digit confirmation code."), { status: 400 });
      }
      if (!deliveryOtpSecret || deliveryOtpSecret.length < 32) {
        jsonResponse(response, 503, { error: "Delivery verification is not configured. Set a DELIVERY_OTP_SECRET of at least 32 characters." });
        return;
      }
      const verified = await mutateStore("orders.json", [], orders => {
        const order = orders.find(item => item.id === orderId && item.riderId === session.user.id);
        if (!order) throw Object.assign(new Error("Assigned order not found."), { status: 404 });
        if (order.status !== "in_transit") {
          throw Object.assign(new Error("This delivery is not waiting for a confirmation code."), { status: 409 });
        }
        if (!order.deliveryCodeHash || !order.deliveryCodeExpiresAt) {
          throw Object.assign(new Error("Request a new confirmation code before completing this delivery."), { status: 409 });
        }
        if (Date.parse(order.deliveryCodeExpiresAt) <= Date.now()) {
          order.deliveryCodeHash = null;
          throw Object.assign(new Error("The confirmation code has expired. Request a new code."), { status: 410 });
        }
        if (Number(order.deliveryCodeAttempts) >= 5) {
          throw Object.assign(new Error("Too many incorrect attempts. Request a new confirmation code."), { status: 429 });
        }
        const submittedHash = crypto.createHmac("sha256", deliveryOtpSecret).update(`${orderId}:${code}`).digest("hex");
        if (!safeEqual(submittedHash, order.deliveryCodeHash)) {
          order.deliveryCodeAttempts = (Number(order.deliveryCodeAttempts) || 0) + 1;
          return { error: "That confirmation code is incorrect.", attemptsRemaining: Math.max(0, 5 - order.deliveryCodeAttempts) };
        }
        order.status = "delivered";
        order.deliveredAt = new Date().toISOString();
        order.updatedAt = order.deliveredAt;
        order.riderCommission = Math.round((Number(order.deliveryFee) || 0) * 0.03 * 100) / 100;
        order.deliveryCodeHash = null;
        order.deliveryCodeExpiresAt = null;
        return { order };
      });
      if (verified.error) {
        jsonResponse(response, 400, verified);
        return;
      }
      await Promise.all([
        notifyOrderStatusChanged(verified.order, session.user.name),
        notifyStoreOfDelivery(verified.order, session.user.name)
      ]);
      jsonResponse(response, 200, {
        order: {
          id: verified.order.id,
          status: verified.order.status,
          riderCommission: verified.order.riderCommission
        }
      });
      return;
    }

    if (request.method === "POST" && route === "POST /api/rider/payout-requests") {
      const session = getSession(request);
      if (!session || session.user.role !== "rider") {
        jsonResponse(response, 403, { error: "Sign in to your approved rider account to request a payout." });
        return;
      }
      const payout = await mutateStore("payout_requests.json", [], async requests => {
        const [riders, orders] = await Promise.all([
          readStore("riders.json", []),
          readStore("orders.json", [])
        ]);
        const rider = riders.find(item => item.id === session.user.id && item.status === "active");
        if (!rider) throw Object.assign(new Error("This rider account is not active."), { status: 403 });
        const earned = orders
          .filter(order => order.riderId === rider.id && order.status === "delivered")
          .reduce((sum, order) => sum + Math.round((Number(order.deliveryFee) || 0) * 0.03 * 100) / 100, 0);
        const committed = requests
          .filter(item => item.riderId === rider.id && ["pending", "paid"].includes(item.status))
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const amount = Math.max(0, Math.round((earned - committed) * 100) / 100);
        if (amount <= 0) throw Object.assign(new Error("There are no available delivery earnings to request."), { status: 409 });
        const weekKey = isoWeekKey();
        if (requests.some(item => item.riderId === rider.id && item.weekKey === weekKey && item.status !== "rejected")) {
          throw Object.assign(new Error("You have already requested a payout this week."), { status: 409 });
        }
        const created = {
          id: crypto.randomUUID(),
          riderId: rider.id,
          amount,
          weekKey,
          status: "pending",
          bankName: rider.bankName,
          accountName: rider.accountName,
          accountNumber: rider.accountNumber,
          createdAt: new Date().toISOString()
        };
        requests.push(created);
        return created;
      });
      await notifyStoreOfPayout(payout, session.user.name);
      jsonResponse(response, 201, {
        payoutRequest: { id: payout.id, amount: payout.amount, status: payout.status, weekKey: payout.weekKey }
      });
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
      if (rejectIfLoginLimited(response, email)) return;
      if (!safeEqual(email, adminEmail) || !safeEqual(password, adminPassword)) {
        recordLoginFailure(email);
        jsonResponse(response, 401, { error: "Email or password is incorrect." });
        return;
      }
      clearLoginFailures(email);
      const user = { id: "admin", name: "Store admin", email: adminEmail, role: "admin" };
      await createSession(response, request, user);
      jsonResponse(response, 200, { user });
      return;
    }

    if (route === "POST /api/auth/logout") {
      const token = readCookies(request).sid;
      if (token && sessions.delete(sessionTokenHash(token))) await persistSessions();
      response.setHeader("Set-Cookie", expiredSessionCookie(request));
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
    if (url.pathname === "/admin.html") {
      response.writeHead(308, {
        Location: `/admin${url.search}`,
        "Cache-Control": "no-store"
      }).end();
      return;
    }

    let requestedPath;
    try {
      const pathname = url.pathname === "/" ? "/index.html"
        : url.pathname === "/admin" ? "/admin.html"
        : url.pathname === "/app" ? "/app.html"
        : url.pathname === "/rider" || url.pathname === "/rider.html" ? "/rider.app.html"
        : url.pathname;
      requestedPath = decodeURIComponent(pathname);
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
    Object.entries(securityHeaders).forEach(([name, value]) => response.setHeader(name, value));
    if (secureCookies) response.setHeader("Strict-Transport-Security", "max-age=31536000");
    try {
      if (url.pathname.startsWith("/api/")) {
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin) {
          let origin;
          try {
            origin = new URL(request.headers.origin);
          } catch {
            origin = null;
          }
          if (!origin || origin.host.toLowerCase() !== String(request.headers.host || "").toLowerCase()) {
            jsonResponse(response, 403, { error: "Cross-origin requests are not allowed." });
            return;
          }
        }
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
    const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
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
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.warn("Using local JSON storage. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to use Supabase.");
      } else {
        console.log("Supabase storage is enabled.");
      }
    });
  }).catch(error => {
    console.error("Could not load server configuration:", error);
    process.exitCode = 1;
  });
}

module.exports = { createServer, loadEnvironmentFile };
