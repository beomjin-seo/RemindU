/* Run with: node --test store.test.cjs (no dependencies). */
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const source = fs.readFileSync(path.join(__dirname, "store.js"), "utf8");

function loadStore(indexedDB) {
  const context = vm.createContext({
    window: {},
    URL,
    crypto: { randomUUID },
    setTimeout,
    clearTimeout,
    indexedDB,
  });
  vm.runInContext(source, context);
  return context.window.StoryStore;
}

// A small asynchronous IndexedDB boundary double: tests persistence semantics,
// not browser implementation details. The actual app must also be browser-tested.
function memoryIndexedDB() {
  const values = new Map();
  let created = false;
  let writeFailure = null;
  const provider = {
    failNextWrite(error) {
      writeFailure = error;
    },
    open() {
      const request = {};
      setTimeout(() => {
        const database = {
          objectStoreNames: { contains: () => created },
          createObjectStore() {
            created = true;
          },
          close() {},
          transaction(name, mode) {
            const transaction = {
              objectStore() {
                return {
                  get(key) {
                    const get = {};
                    setTimeout(() => {
                      get.result = structuredClone(values.get(key));
                      get.onsuccess?.();
                    }, 0);
                    return get;
                  },
                  put(value, key) {
                    setTimeout(() => {
                      if (writeFailure) {
                        transaction.error = writeFailure;
                        writeFailure = null;
                        transaction.onabort?.();
                      } else {
                        values.set(key, structuredClone(value));
                        transaction.oncomplete?.();
                      }
                    }, 0);
                  },
                };
              },
            };
            return transaction;
          },
        };
        request.result = database;
        if (!created) request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
  return provider;
}

test("memory fallback is explicit; fixtures are honest and defensive", async () => {
  const store = loadStore();
  await store.ready();
  assert.equal(store.storageMode, "memory");
  assert.ok(store.errorMessage.includes("새로고침"));
  assert.equal(store.list().length, 9);
  assert.ok(
    store.list().every((item) => item.sample && item.sourceState === "sample"),
  );
  assert.equal(
    store.list().find((item) => item.id === "books").title,
    "데스크 조명",
  );
  assert.equal(
    store.list().find((item) => item.id === "books").folder,
    "공간 · 인테리어",
  );
  assert.equal(store.folders().length, 5);
  const first = store.list()[0];
  first.tags.push("mutation");
  first.title = "mutation";
  assert.notEqual(store.list()[0].title, "mutation");
  assert.ok(!store.list()[0].tags.includes("mutation"));
  store.folders().push("mutation");
  assert.ok(!store.folders().includes("mutation"));
});

test("links are validated, classified by hostname, and duplicate commits are serialized", async () => {
  const store = loadStore();
  await store.ready();
  const result = await store.add({
    url: "https://www.youtube.com/shorts/test",
    title: "영상",
  });
  assert.equal(result.platform, "YouTube");
  assert.equal(result.folder, "미분류");
  assert.equal(result.sample, false);
  assert.equal(result.sourceState, "saved");
  await assert.rejects(store.add({ url: "javascript:alert(1)" }), /http/);
  await assert.rejects(
    store.add({ url: "https://user:password@example.com/" }),
    /http/,
  );
  await assert.rejects(
    store.add({ url: `${result.url}#section` }),
    /이미 저장/,
  );
  const parallel = await Promise.allSettled([
    store.add({ url: "https://example.com/post" }),
    store.add({ url: "https://example.com/post" }),
  ]);
  assert.equal(
    parallel.filter((entry) => entry.status === "fulfilled").length,
    1,
  );
  const spoof = await store.add({ url: "https://youtube.com.evil.example/" });
  assert.equal(spoof.platform, "웹 링크");
});

test("screenshots retain raster data, unknown properties cannot change stored identity", async () => {
  const store = loadStore();
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const item = await store.add({ image, platform: "스크린샷", sample: true });
  assert.equal(item.image, image);
  assert.equal(item.sourceState, "missing");
  assert.equal(item.sample, false);
  const modified = await store.update(item.id, {
    id: "evil",
    savedAt: 0,
    favorite: true,
    sample: true,
    sourceState: "sample",
  });
  assert.equal(modified.id, item.id);
  assert.equal(modified.savedAt, item.savedAt);
  assert.equal(modified.favorite, true);
  assert.equal(modified.sample, false);
  await assert.rejects(
    store.add({ image: "data:image/svg+xml;base64,PHN2Zz4=" }),
    /http/,
  );
  const polluted = JSON.parse(
    '{"url":"https://example.org/safe","__proto__":{"admin":true},"constructor":{"admin":true}}',
  );
  const clean = await store.add(polluted);
  assert.equal(clean.admin, undefined);
  assert.equal(Object.prototype.admin, undefined);
});

test("field limits, folder creation, update, undo and export", async () => {
  const store = loadStore();
  await store.ready();
  await assert.rejects(store.addFolder(" "), /입력/);
  await assert.rejects(store.addFolder("A".repeat(61)), /60/);
  await store.addFolder("읽을거리");
  await assert.rejects(store.addFolder("읽을거리"), /같은 이름/);
  const item = await store.add({
    url: "https://example.com/article",
    folder: "읽을거리",
    tags: ["읽기", "읽기"],
  });
  assert.equal(item.tags.length, 1);
  await assert.rejects(
    store.update(item.id, { title: "a".repeat(201) }),
    /200/,
  );
  await assert.rejects(
    store.update(item.id, { note: "a".repeat(4001) }),
    /4000/,
  );
  await assert.rejects(
    store.update(item.id, { tags: Array(21).fill("a") }),
    /20/,
  );
  await assert.rejects(store.update(item.id, { folder: "없는 폴더" }), /먼저/);
  await assert.rejects(store.update(item.id, { favorite: "yes" }), /즐겨찾기/);
  const deleted = await store.remove(item.id);
  assert.ok(!store.list().some((entry) => entry.id === item.id));
  await store.restore(deleted);
  assert.ok(store.list().some((entry) => entry.id === item.id));
  await assert.rejects(store.restore(deleted), /이미 복원/);
  const exported = store.exportData();
  assert.equal(exported.version, 1);
  assert.equal(exported.app, "Storyge");
  assert.ok(exported.folders.includes("읽을거리"));
  exported.items[0].tags.push("export mutation");
  assert.ok(!store.list()[0].tags.includes("export mutation"));
});

test("reload restores saved data and never reseeds an empty library", async () => {
  const idb = memoryIndexedDB();
  const first = loadStore(idb);
  await first.ready();
  assert.equal(first.storageMode, "persistent");
  assert.equal(first.errorMessage, "");
  const image = "data:image/webp;base64,UklGRg==";
  const added = await first.add({
    title: "실제 저장",
    image,
    platform: "스크린샷",
  });
  const second = loadStore(idb);
  await second.ready();
  assert.equal(second.list().length, 10);
  assert.equal(second.list().find((item) => item.id === added.id).image, image);
  for (const item of second.list()) await second.remove(item.id);
  const third = loadStore(idb);
  await third.ready();
  assert.equal(third.list().length, 0);
});

test("quota failure preserves the current session and reports non-persistence", async () => {
  const idb = memoryIndexedDB();
  const store = loadStore(idb);
  await store.ready();
  const error = new Error("Quota exceeded");
  error.name = "QuotaExceededError";
  idb.failNextWrite(error);
  const item = await store.add({ url: "https://example.com/too-large" });
  assert.equal(store.storageMode, "memory");
  assert.ok(store.errorMessage.includes("저장 공간"));
  assert.ok(store.list().some((entry) => entry.id === item.id));
  const reloaded = loadStore(idb);
  await reloaded.ready();
  assert.equal(reloaded.list().length, 9);
});
