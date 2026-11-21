const assert = require("node:assert/strict");
const { test } = require("node:test");
const { SupabaseStore } = require("../supabase-store");

test("reads and upserts supported Supabase collections", async () => {
  const requests = [];
  const store = new SupabaseStore({
    url: "https://example.supabase.co",
    serviceRoleKey: "server-only-test-key",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response("[]", { status: 200 });
    }
  });

  assert.equal(await store.getCollection("orders"), null);
  await store.setCollection("orders", [{ id: "order-1" }]);

  assert.match(requests[0].url, /\/rest\/v1\/app_store\?collection=eq\.orders/);
  assert.equal(requests[0].options.headers.authorization, "Bearer server-only-test-key");
  assert.equal(requests[1].options.method, "POST");
  assert.equal(JSON.parse(requests[1].options.body)[0].records[0].id, "order-1");
  await assert.rejects(() => store.getCollection("unknown"), /not supported/);
});

test("uploads and downloads private profile avatars through Supabase Storage", async () => {
  const requests = [];
  const image = Buffer.from([1, 2, 3]);
  const store = new SupabaseStore({
    url: "https://example.supabase.co",
    serviceRoleKey: "server-only-test-key",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return options.method === "POST"
        ? new Response(null, { status: 200 })
        : new Response(image, { status: 200, headers: { "content-type": "image/png" } });
    }
  });

  await store.uploadAvatar("user-id/avatar.png", image, "image/png");
  const downloaded = await store.downloadAvatar("user-id/avatar.png");

  assert.match(requests[0].url, /\/storage\/v1\/object\/profile-avatars\/user-id\/avatar\.png$/);
  assert.equal(requests[0].options.headers["x-upsert"], "true");
  assert.match(requests[1].url, /\/object\/authenticated\/profile-avatars\/user-id\/avatar\.png$/);
  assert.deepEqual(downloaded.buffer, image);
  assert.equal(downloaded.contentType, "image/png");
});

test("requires HTTPS Supabase URLs except for localhost", () => {
  assert.throws(() => new SupabaseStore({
    url: "http://example.com",
    serviceRoleKey: "test"
  }), /HTTPS URL/);
  assert.doesNotThrow(() => new SupabaseStore({
    url: "http://localhost:54321",
    serviceRoleKey: "test"
  }));
});
