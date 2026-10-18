import { BUCKET, LIMITS, collectPages, digest, ensure, sha256 } from "./backup-common.mjs";
import { planAuthUsers, planStorageObjects } from "./migration-data-common.mjs";

// The caller verifies the target, source archive, private credential bundle and
// exclusive migration window, and supplies a transport-guarded client. This
// module never constructs a client, logs private records or retries writes.
const PAGE_SIZE = 100;
const safePath = (path) => typeof path === "string" && path.length <= 1024 &&
  path.split("/").every((part) => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== "." && part !== "..");

async function operation(run, code) {
  let result;
  try { result = await run(); } catch { /* SDK exceptions can contain credentials. */ }
  ensure(result && !result.error && result.data !== null && result.data !== undefined,
    code, "La operacion de migracion fallo; no se reintenta ni se muestran datos privados.");
  return result.data;
}

async function readUsers(client) {
  let page = 0;
  return collectPages(async (_offset, perPage) => {
    const data = await operation(() => client.auth.admin.listUsers({ page: ++page, perPage }),
      "AUTH_READ_FAILED");
    ensure(data.total === undefined || (Number.isSafeInteger(data.total) && data.total >= 0),
      "AUTH_READ_FAILED", "El total de identidades no es valido.");
    return { rows: data.users, total: data.total };
  }, { pageSize: PAGE_SIZE, max: LIMITS.rowsPerTable });
}

function bucketMatches(actual, expected) {
  return actual?.id === BUCKET && actual.name === BUCKET && actual.public === false &&
    expected?.id === BUCKET && expected.name === BUCKET && expected.public === false &&
    Number.isSafeInteger(expected.file_size_limit) && expected.file_size_limit > 0 &&
    actual.file_size_limit === expected.file_size_limit &&
    Array.isArray(actual.allowed_mime_types) && Array.isArray(expected.allowed_mime_types) &&
    digest([...actual.allowed_mime_types].sort()) === digest([...expected.allowed_mime_types].sort());
}

async function verifyBucket(client, expected) {
  const buckets = await collectPages(async (offset, limit) => ({ rows: await operation(
    () => client.storage.listBuckets({ limit, offset, sortColumn: "name", sortOrder: "asc" }),
    "BUCKET_READ_FAILED",
  ) }), { pageSize: PAGE_SIZE, max: LIMITS.objects });
  ensure(buckets.length === 1 && buckets[0].id === BUCKET && buckets[0].name === BUCKET,
    "BUCKET_CONFLICT", "El destino debe contener solamente el bucket autorizado.");
  const bucket = await operation(() => client.storage.getBucket(BUCKET), "BUCKET_READ_FAILED");
  ensure(bucketMatches(bucket, expected), "BUCKET_CONFLICT",
    "Privacidad, limite de archivo o tipos MIME del bucket difieren del origen.");
}

async function readInventory(storage) {
  const folders = [""], visited = new Set([""]), objects = [], paths = new Set();
  for (let i = 0; i < folders.length; i++) {
    const prefix = folders[i];
    const entries = await collectPages(async (offset, limit) => ({ rows: await operation(
      () => storage.list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } }),
      "STORAGE_LIST_FAILED",
    ) }), { pageSize: PAGE_SIZE, max: LIMITS.objects });
    const entryNames = new Set();
    for (const entry of entries) {
      ensure(typeof entry?.name === "string" && !entry.name.includes("/") &&
        safePath(entry.name) && !entryNames.has(entry.name),
      "STORAGE_CONFLICT", "El inventario contiene nombres invalidos o duplicados.");
      entryNames.add(entry.name);
      const path = prefix ? prefix + "/" + entry.name : entry.name;
      ensure(safePath(path), "STORAGE_CONFLICT", "El inventario contiene una ruta no permitida.");
      if (entry.id === null) {
        ensure(!visited.has(path) && folders.length < LIMITS.objects,
          "STORAGE_CONFLICT", "El inventario contiene carpetas repetidas o excede el limite.");
        visited.add(path);
        folders.push(path);
      } else {
        ensure(typeof entry.id === "string" && entry.id && !paths.has(path) && objects.length < LIMITS.objects,
          "STORAGE_CONFLICT", "El inventario contiene objetos invalidos o repetidos.");
        paths.add(path);
        objects.push({ path, metadata: entry.metadata });
      }
    }
  }
  return objects;
}

function validateObjects(payload) {
  ensure(Array.isArray(payload.objects) && payload.objects.length <= LIMITS.objects,
    "SOURCE_OBJECT_INVALID", "El inventario de origen no es valido.");
  let total = 0;
  const paths = new Set();
  for (const object of payload.objects) {
    ensure(safePath(object.path) && !paths.has(object.path) &&
      Number.isSafeInteger(object.bytes) && object.bytes >= 0 &&
      object.bytes <= payload.bucket.file_size_limit && typeof object.dataBase64 === "string" &&
      payload.bucket.allowed_mime_types?.includes(object.metadata?.mimetype),
    "SOURCE_OBJECT_INVALID", "Ruta, tamano o tipo del objeto de origen no valido.");
    paths.add(object.path);
    const bytes = Buffer.from(object.dataBase64, "base64");
    ensure(bytes.length === object.bytes && sha256(bytes) === object.sha256,
      "SOURCE_OBJECT_INVALID", "El contenido del objeto no coincide con el respaldo.");
    total += bytes.length;
    ensure(total <= LIMITS.totalObjectBytes, "SOURCE_OBJECT_INVALID", "El archivo supera el limite de bytes.");
  }
}

async function readObjects(storage, expected) {
  const inventory = await readInventory(storage);
  const source = new Map(expected.map((object) => [object.path, object]));
  ensure(inventory.every((object) => source.has(object.path)), "STORAGE_CONFLICT",
    "El bucket contiene objetos ajenos; no se borran ni se sobrescriben.");
  const verified = [];
  for (const object of inventory) {
    const original = source.get(object.path);
    ensure(object.metadata?.mimetype === original.metadata.mimetype &&
      Number(object.metadata.size) === original.bytes,
    "STORAGE_CONFLICT", "El tamano o MIME del objeto existente difiere del origen.");
    const blob = await operation(() => storage.download(object.path), "STORAGE_DOWNLOAD_FAILED");
    ensure(blob.size === original.bytes && blob.type === original.metadata.mimetype,
      "STORAGE_CONFLICT", "Los bytes o MIME descargados difieren del inventario de origen.");
    let bytes;
    try { bytes = Buffer.from(await blob.arrayBuffer()); } catch { /* safe failure below */ }
    ensure(bytes && bytes.length === original.bytes, "STORAGE_DOWNLOAD_FAILED",
      "No se pudo leer el contenido completo del objeto.");
    verified.push({ path: object.path, sha256: sha256(bytes), bytes: bytes.length, contentType: blob.type });
  }
  return verified;
}

export async function migrateAuthStorage({ client, payload, credentials, onProgress = async () => {} }) {
  validateObjects(payload);
  const initialUsers = await readUsers(client);
  const authPlan = planAuthUsers(payload, initialUsers, credentials);
  await verifyBucket(client, payload.bucket);
  const storage = client.storage.from(BUCKET);
  const objectPlan = planStorageObjects(payload.objects, await readObjects(storage, payload.objects));
  const result = {
    authCreated: 0, authReused: authPlan.filter((item) => item.action === "reuse").length,
    objectsUploaded: 0, objectsReused: objectPlan.filter((item) => item.action === "reuse").length,
    objectsVerified: 0, bytesVerified: 0,
  };
  await onProgress({ phase: "auth-storage-preflight", authPending: payload.users.length - result.authReused,
    objectsPending: payload.objects.length - result.objectsReused });
  for (const item of authPlan) {
    if (item.action !== "create") continue;
    const data = await operation(() => client.auth.admin.createUser(item.attributes), "AUTH_CREATE_FAILED");
    ensure(data.user?.id === item.attributes.id && data.user.email === item.attributes.email &&
      data.user.app_metadata?.tolentino_migration &&
      digest(data.user.app_metadata?.tolentino_migration) === digest(item.attributes.app_metadata.tolentino_migration),
    "AUTH_CREATE_MISMATCH", "La identidad creada no coincide con el UUID y marcador autorizados.");
    result.authCreated++;
    await onProgress({ phase: "auth-created", count: result.authCreated });
  }
  ensure(planAuthUsers(payload, await readUsers(client), credentials).every((item) => item.action === "reuse"),
    "AUTH_VERIFY_FAILED", "La relectura de Auth no confirma todas las identidades y marcadores.");
  await onProgress({ phase: "auth-verified", count: payload.users.length });
  for (const item of objectPlan) {
    if (item.action !== "upload") continue;
    const object = payload.objects.find((entry) => entry.path === item.path);
    const data = await operation(() => storage.upload(object.path, Buffer.from(object.dataBase64, "base64"), {
      upsert: false, contentType: object.metadata.mimetype, cacheControl: "3600",
    }), "STORAGE_UPLOAD_FAILED");
    ensure(data.path === object.path, "STORAGE_UPLOAD_MISMATCH", "La ruta subida no coincide con la autorizada.");
    result.objectsUploaded++;
    await onProgress({ phase: "storage-uploaded", count: result.objectsUploaded });
  }
  await verifyBucket(client, payload.bucket);
  const finalObjects = await readObjects(storage, payload.objects);
  ensure(planStorageObjects(payload.objects, finalObjects).every((item) => item.action === "reuse"),
    "STORAGE_VERIFY_FAILED", "El inventario final no confirma todos los objetos del respaldo.");
  result.objectsVerified = finalObjects.length;
  result.bytesVerified = finalObjects.reduce((sum, object) => sum + object.bytes, 0);
  await onProgress({ phase: "auth-storage-verified", ...result });
  return result;
}
