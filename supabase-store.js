const allowedCollections = new Set(["products", "users", "orders", "sessions", "riders", "payout_requests", "support"]);

class SupabaseStore {
  constructor({ url, serviceRoleKey, fetchImpl = globalThis.fetch, avatarBucket = "profile-avatars" }) {
    if (!url || !serviceRoleKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
    }

    const parsedUrl = new URL(url);
    if (!["https:", "http:"].includes(parsedUrl.protocol) ||
        (parsedUrl.protocol === "http:" && !["localhost", "127.0.0.1"].includes(parsedUrl.hostname))) {
      throw new Error("SUPABASE_URL must be an HTTPS URL.");
    }
    if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required for Supabase.");

    this.url = parsedUrl.origin;
    this.serviceRoleKey = serviceRoleKey;
    this.fetchImpl = fetchImpl;
    this.avatarBucket = avatarBucket;
  }

  async request(path, options = {}) {
    const response = await this.fetchImpl(`${this.url}${path}`, {
      ...options,
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        ...(options.body instanceof Uint8Array ? {} : { "content-type": "application/json" }),
        ...options.headers
      }
    });
    if (!response.ok) {
      throw new Error(`Supabase request failed with HTTP ${response.status}.`);
    }
    return response;
  }

  assertCollection(collection) {
    if (!allowedCollections.has(collection)) {
      throw new Error("The requested Supabase collection is not supported.");
    }
  }

  async getCollection(collection) {
    this.assertCollection(collection);
    const query = new URLSearchParams({
      collection: `eq.${collection}`,
      select: "records"
    });
    const response = await this.request(`/rest/v1/app_store?${query}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length > 1) {
      throw new Error("Supabase returned an invalid collection response.");
    }
    if (rows.length === 0) return null;
    if (!Array.isArray(rows[0].records)) {
      throw new Error("Supabase returned invalid collection data.");
    }
    return rows[0].records;
  }

  async setCollection(collection, records) {
    this.assertCollection(collection);
    if (!Array.isArray(records)) throw new Error("Supabase collection data must be an array.");
    const query = new URLSearchParams({ on_conflict: "collection" });
    await this.request(`/rest/v1/app_store?${query}`, {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ collection, records, updated_at: new Date().toISOString() }])
    });
  }

  async uploadAvatar(objectPath, buffer, contentType) {
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    await this.request(`/storage/v1/object/${encodeURIComponent(this.avatarBucket)}/${encodedPath}`, {
      method: "POST",
      headers: {
        "content-type": contentType,
        "x-upsert": "true"
      },
      body: buffer
    });
  }

  async downloadAvatar(objectPath) {
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    const response = await this.request(
      `/storage/v1/object/authenticated/${encodeURIComponent(this.avatarBucket)}/${encodedPath}`
    );
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") || "application/octet-stream"
    };
  }
}

module.exports = { SupabaseStore };
