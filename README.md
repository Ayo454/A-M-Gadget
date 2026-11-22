# A&M Gadget

## Run the store

This project uses Node.js built-in modules and does not need package installation.

1. Copy `.env.example` to `.env`.
2. Set `ADMIN_EMAIL` and replace `ADMIN_PASSWORD` with a strong password in `.env`.
3. In the project folder, run `node server.js`.
4. Open the local address configured by `PORT` in `.env` (currently `http://127.0.0.1:38123`).

To enable transactional email, add `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` to `.env`; the sender email must be verified in Brevo. `BREVO_SENDER_NAME` is optional and defaults to `A&M Gadget`. To email the store when an order is placed, delivered, or a rider requests a payout, set `ORDER_NOTIFICATION_EMAIL` (it defaults to `ADMIN_EMAIL`). To send brief SMS alerts for these events, set `ORDER_NOTIFICATION_PHONES` to a comma-separated list of phone numbers. Delivery alerts identify the rider, and payout alerts include the rider's name, requested amount, and earnings week; bank details remain in the admin dashboard. For rider delivery verification and store SMS, create a private Brevo M2M app with the `transactional.sms:write` scope and configure its credentials in `BREVO_OAUTH_CLIENT_ID` and `BREVO_OAUTH_CLIENT_SECRET`. Set an approved SMS sender in `BREVO_SMS_SENDER` (up to 11 alphanumeric or 15 numeric characters) and a random `DELIVERY_OTP_SECRET` of at least 32 characters. Brevo must have transactional SMS enabled and support each destination. Delivery codes expire after 10 minutes, allow five attempts, and can be requested once per minute. Set these values only in the private `.env` file or the hosting provider's environment settings.

To use Supabase, open the Supabase SQL Editor and run `supabase-schema.sql`. The `app_store` table keeps products, users, orders, sessions, riders, and payout requests as JSON arrays; profile photos go in a private Storage bucket. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the private `.env` file and on the Node.js hosting service. This key is server-only: never put it in browser code or commit it. Before the first server start, run `npm run migrate:supabase` to copy existing JSON data and profile photos. Migration refuses to overwrite non-empty collections unless `--replace` is supplied. When both Supabase settings are configured, the app uses Supabase; without them, it continues using local JSON files.

GitHub Pages can serve the static frontend but cannot run this Node.js server. Registration, checkout, admin APIs, and email require the server to be deployed to a Node.js host.

To deploy on Render, create a Web Service for the `main` branch of this repository, leave Root Directory blank, use `npm install` as the Build Command and `npm start` as the Start Command. Set `NODE_ENV` to `production`; Render supplies `PORT`, and the server binds to `0.0.0.0` in production. Add admin, Brevo, Supabase, and payment settings as Render environment variables (never commit their values). Run the Supabase schema and local-data migration before deploying if you need to preserve existing data.

To host the frontend on Netlify while keeping the API on Render, deploy this repository's root directory to Netlify. The `netlify.toml` file proxies `/api/*` requests to `https://a-m-gadget.onrender.com`, keeping API and session-cookie requests on the Netlify site origin. Redeploy on Netlify after adding or changing this configuration.

The preferred admin dashboard URL is `/admin`; requests to `/admin.html` redirect there.

The admin signs in at `/admin` to manage the catalog, users, orders, rider applications, and payouts. Approved riders sign in at `/rider.html`; new applications remain pending until an admin approves them. Admins manually assign approved riders to paid orders. Riders start deliveries and can complete them only after entering the customer's six-digit code, sent by both email and SMS. The code is stored as a keyed hash, expires after 10 minutes, and allows at most five attempts. Riders earn 3% of the delivery fee after a successful code check and may request one payout per ISO calendar week; admins manually mark transfers as paid or reject requests. Email/SMS delivery requires the Brevo settings above. Session records are kept in private storage, with session tokens stored as hashes, and the browser cookie persists for up to 400 days. A static preview server does not provide the APIs.

Product prices are displayed in Nigerian naira (NGN). Customers can create an account at `/account.html`; checkout shows the server-calculated item subtotal, delivery fee, and total. Delivery is ₦2,500 within Ogun State and ₦3,500 to Ibadan, Oyo State. Other destinations use OpenStreetMap geocoding and OSRM road distance from Ilishan-Remo, with a default ₦1,000 base plus ₦35 per km, rounded up to the next ₦100 and a ₦2,500 minimum. These public services have usage limits and no uptime guarantee. Set `DELIVERY_ORIGIN`, `DELIVERY_BASE_NGN`, `DELIVERY_PER_KM_NGN`, and `DELIVERY_MINIMUM_NGN` as needed. To accept orders, set `PAYMENT_BANK_NAME`, `PAYMENT_ACCOUNT_NAME`, and `PAYMENT_ACCOUNT_NUMBER`. Admins verify payments before assigning a rider; eligible orders may be cancelled, and cancellation after payment confirmation is marked as requiring a refund. Customer passwords are salted and hashed. Profile photos are stored privately and served only to the signed-in customer.

Keep `.env` private. For a live website, use HTTPS and configure the admin credentials and persistent data storage on the hosting provider.

## Tests

Run the server and account tests with `node --test`.
