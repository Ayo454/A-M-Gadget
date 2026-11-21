const fs = require("node:fs/promises");
const path = require("node:path");
const { loadEnvironmentFile } = require("../server");
const { SupabaseStore } = require("../supabase-store");

const projectDirectory = path.join(__dirname, "..");
const dataDirectory = path.join(projectDirectory, "data");
const collections = ["products", "users", "orders", "sessions"];

async function readCollection(collection) {
  try {
    const contents = await fs.readFile(path.join(dataDirectory, `${collection}.json`), "utf8");
    const records = JSON.parse(contents);
    if (!Array.isArray(records)) throw new Error(`Local ${collection}.json must contain an array.`);
    return records;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function main() {
  await loadEnvironmentFile();
  const store = new SupabaseStore({
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  });
  const replaceExisting = process.argv.includes("--replace");
  const records = Object.fromEntries(await Promise.all(
    collections.map(async collection => [collection, await readCollection(collection)])
  ));

  const existing = await Promise.all(collections.map(async collection => ({
    collection,
    records: await store.getCollection(collection)
  })));
  const occupied = existing.filter(item => item.records && item.records.length > 0);
  if (occupied.length > 0 && !replaceExisting) {
    throw new Error(
      `Supabase already contains data in: ${occupied.map(item => item.collection).join(", ")}. ` +
      "Use --replace only if you intend to overwrite it."
    );
  }

  const updatedAvatarPaths = new Map();
  for (const user of records.users) {
    if (!user.avatarFile) continue;
    const filename = path.basename(user.avatarFile);
    if (filename !== user.avatarFile || !user.id) {
      throw new Error("A local customer avatar has an invalid filename or customer ID.");
    }
    const imagePath = path.join(dataDirectory, "uploads", filename);
    const image = await fs.readFile(imagePath);
    const objectPath = `${user.id}/${filename}`;
    await store.uploadAvatar(objectPath, image, user.avatarType);
    updatedAvatarPaths.set(user.id, objectPath);
    user.avatarFile = objectPath;
  }

  for (const session of records.sessions) {
    const user = session && session.user;
    if (!user || !updatedAvatarPaths.has(user.id)) continue;
    user.avatarFile = updatedAvatarPaths.get(user.id);
  }

  for (const collection of collections) {
    await store.setCollection(collection, records[collection]);
    console.log(`Migrated ${records[collection].length} ${collection} record(s).`);
  }
}

main().catch(error => {
  console.error("Supabase migration failed:", error.message);
  process.exitCode = 1;
});
