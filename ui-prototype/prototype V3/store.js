/* Storyge V3: local-first storage. No AI or server requests are simulated here. */
(() => {
  "use strict";

  const DB_NAME = "storyge-prototype-v3";
  const STORE_NAME = "library";
  const STATE_KEY = "state";
  const SCHEMA_VERSION = 1;
  const DEFAULT_FOLDERS = [
    "공간 · 인테리어",
    "패션 · 쇼핑",
    "여행 · 장소",
    "일상 · 기타",
    "미분류",
  ];
  const PLATFORMS = ["스크린샷", "YouTube", "Instagram", "웹 링크"];
  const SAMPLE_ROWS = [
    [
      "chair",
      "원목 의자",
      "스크린샷",
      "공간 · 인테리어",
      ["원목", "의자", "가구"],
      "1503602642458-232111445657",
    ],
    [
      "forest",
      "숲 사진",
      "Instagram",
      "여행 · 장소",
      ["숲", "산책", "자연"],
      "1441974231531-c6227db76b6e",
    ],
    [
      "coffee",
      "라테 사진",
      "YouTube",
      "일상 · 기타",
      ["커피", "홈카페", "라테"],
      "1495474472287-4d71bcdd2085",
    ],
    [
      "style",
      "여름 의상",
      "Instagram",
      "패션 · 쇼핑",
      ["옷", "여름", "스타일"],
      "1515886657613-9f3515b0c78f",
    ],
    [
      "interior",
      "거실 인테리어",
      "스크린샷",
      "공간 · 인테리어",
      ["거실", "베이지", "조명"],
      "1600210492486-724fe5c67fb0",
    ],
    [
      "shoe",
      "스니커즈",
      "스크린샷",
      "패션 · 쇼핑",
      ["신발", "스니커즈", "브라운"],
      "1549298916-b41d501d3772",
    ],
    [
      "lake",
      "호수와 산",
      "스크린샷",
      "여행 · 장소",
      ["호수", "산", "여행"],
      "1470770841072-f978cf4d019e",
    ],
    [
      "perfume",
      "향수",
      "웹 링크",
      "패션 · 쇼핑",
      ["향수", "선물"],
      "1541643600914-78b084683601",
    ],
    [
      "books",
      "데스크 조명",
      "웹 링크",
      "공간 · 인테리어",
      ["조명", "책상", "인테리어"],
      "1494438639946-1ebd1d20bf85",
    ],
  ];

  let database = null;
  let mode = "memory";
  let storageError = "";
  let state = { items: [], folders: [...DEFAULT_FOLDERS] };
  let initialized = null;
  let pending = Promise.resolve();

  const copyItem = (item) => ({ ...item, tags: [...item.tags] });
  const isObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const owns = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key);

  function text(value, label, maximum, fallback = "") {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== "string")
      throw new Error(`${label} 형식을 확인하세요.`);
    const result = value.trim();
    if (result.length > maximum)
      throw new Error(`${label}은(는) ${maximum}자 이내로 입력하세요.`);
    return result;
  }

  function normalizeURL(value) {
    const input = text(value, "링크", 8192);
    if (!input) return "";
    try {
      const url = new URL(input);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password
      )
        throw new Error();
      return url.href;
    } catch (_) {
      throw new Error("http 또는 https로 시작하는 링크를 입력하세요.");
    }
  }

  function urlKey(value) {
    if (!value) return "";
    const url = new URL(value);
    url.hash = "";
    return url.href;
  }

  function normalizeImage(value) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string") throw new Error("이미지 형식을 확인하세요.");
    // SVG data URLs are deliberately excluded: image uploads are raster files only.
    if (
      /^data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(
        value,
      )
    ) {
      if (value.length > 16 * 1024 * 1024)
        throw new Error(
          "이미지 크기가 너무 큽니다. 10MB 이하의 이미지를 선택하세요.",
        );
      return value;
    }
    if (
      /^assets\/(?:chair|forest|coffee|style|interior|shoe|lake|perfume|books)\.jpg$/.test(
        value,
      )
    )
      return value;
    return normalizeURL(value);
  }

  function normalizeTags(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error("키워드 형식을 확인하세요.");
    if (value.length > 20)
      throw new Error("키워드는 최대 20개까지 저장할 수 있습니다.");
    return [
      ...new Set(value.map((tag) => text(tag, "키워드", 60)).filter(Boolean)),
    ];
  }

  function folderName(value) {
    const name = text(value, "폴더 이름", 60);
    if (!name) throw new Error("폴더 이름을 입력하세요.");
    return name;
  }

  function inferPlatform(url, image) {
    if (url) {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname === "youtu.be" || /(^|\.)youtube\.com$/.test(hostname))
        return "YouTube";
      if (/(^|\.)instagram\.com$/.test(hostname)) return "Instagram";
      return "웹 링크";
    }
    return image ? "스크린샷" : "웹 링크";
  }

  function normalizeItem(data, existing = null, trusted = false) {
    if (!isObject(data)) throw new Error("저장 항목 형식을 확인하세요.");
    const value = (key) => (owns(data, key) ? data[key] : existing?.[key]);
    const url = normalizeURL(value("url"));
    const image = normalizeImage(value("image"));
    const platform = value("platform") || inferPlatform(url, image);
    if (!PLATFORMS.includes(platform))
      throw new Error("지원하지 않는 플랫폼입니다.");
    if (!url && !image) throw new Error("링크 또는 이미지를 추가하세요.");
    if (platform !== "스크린샷" && !url)
      throw new Error("원본 링크를 입력하세요.");
    const fallbackTitle = url
      ? new URL(url).hostname.replace(/^www\./, "")
      : "스크린샷";
    const title =
      text(value("title"), "제목", 200, fallbackTitle) || fallbackTitle;
    const folder = folderName(value("folder") || "미분류");
    const favorite = value("favorite") ?? false;
    if (typeof favorite !== "boolean")
      throw new Error("즐겨찾기 형식을 확인하세요.");
    // A new user item cannot claim to be sample data or an AI-verified source.
    const sample = existing ? existing.sample : trusted && data.sample === true;
    const savedAt = existing
      ? existing.savedAt
      : trusted && Number.isFinite(data.savedAt)
        ? data.savedAt
        : Date.now();
    const id =
      existing?.id ||
      (trusted ? text(data.id, "항목 ID", 120) : "") ||
      makeID();
    return {
      id,
      title,
      platform,
      folder,
      tags: normalizeTags(value("tags")),
      note: text(value("note"), "메모", 4000),
      url,
      image,
      sample,
      sourceState: sample ? "sample" : url ? "saved" : "missing",
      favorite,
      savedAt,
    };
  }

  function makeID() {
    return (
      globalThis.crypto?.randomUUID?.() ||
      `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
    );
  }

  function seed() {
    const now = Date.now();
    return {
      folders: [...DEFAULT_FOLDERS],
      items: SAMPLE_ROWS.map(
        ([id, title, platform, folder, tags, photo], index) => ({
          id,
          title,
          platform,
          folder,
          tags: [...tags],
          note: "",
          image: `assets/${id}.jpg`,
          url: `https://images.unsplash.com/photo-${photo}?auto=format&fit=max&w=1600&q=90`,
          sample: true,
          sourceState: "sample",
          favorite: false,
          savedAt: now - index * 86400000,
        }),
      ),
    };
  }

  function toMemory(error) {
    database?.close();
    database = null;
    mode = "memory";
    const quota = error?.name === "QuotaExceededError";
    storageError = quota
      ? "브라우저 저장 공간이 부족합니다. 이후 변경은 새로고침하면 사라집니다. 먼저 데이터를 내보내세요."
      : "브라우저 저장소를 사용할 수 없습니다. 현재 변경은 새로고침하면 사라집니다. 데이터를 내보내 보관하세요.";
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      let request;
      try {
        request = globalThis.indexedDB.open(DB_NAME, 1);
      } catch (error) {
        reject(error);
        return;
      }
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error("Storage timeout")), 5000);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME))
          request.result.createObjectStore(STORE_NAME);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error("Storage blocked"));
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(request.result);
      };
    });
  }

  function readState() {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function persist() {
    if (!database) return;
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        transaction
          .objectStore(STORE_NAME)
          .put(
            {
              version: SCHEMA_VERSION,
              items: state.items,
              folders: state.folders,
            },
            STATE_KEY,
          );
      });
    } catch (error) {
      toMemory(error);
    }
  }

  async function initialize() {
    // Seeds remain usable when a private/blocked browser disallows IndexedDB.
    state = seed();
    try {
      database = await openDatabase();
      database.onversionchange = () =>
        toMemory(new Error("Storage version changed"));
      const stored = await readState();
      if (stored !== undefined) {
        if (
          !isObject(stored) ||
          stored.version !== SCHEMA_VERSION ||
          !Array.isArray(stored.items) ||
          !Array.isArray(stored.folders)
        )
          throw new Error("Invalid saved library");
        const folders = [
          ...new Set([...DEFAULT_FOLDERS, ...stored.folders.map(folderName)]),
        ];
        const items = stored.items.map((item) =>
          normalizeItem(item, null, true),
        );
        if (new Set(items.map((item) => item.id)).size !== items.length)
          throw new Error("Duplicate saved ID");
        items.forEach((item) => {
          if (!folders.includes(item.folder)) folders.push(item.folder);
        });
        state = { items, folders };
      }
      mode = "persistent";
      if (stored === undefined) await persist();
    } catch (error) {
      toMemory(error);
    }
  }

  function ready() {
    if (!initialized) initialized = initialize();
    return initialized;
  }

  function mutate(action) {
    const operation = pending.then(async () => {
      await ready();
      const result = action();
      await persist();
      return result;
    });
    pending = operation.catch(() => {});
    return operation;
  }

  function ensureFolder(item) {
    if (!state.folders.includes(item.folder))
      throw new Error("폴더를 먼저 만든 후 선택하세요.");
  }

  function ensureUniqueURL(item, skipId = "") {
    if (!item.url) return;
    if (
      state.items.some(
        (other) =>
          other.id !== skipId &&
          other.url &&
          urlKey(other.url) === urlKey(item.url),
      )
    ) {
      throw new Error("이미 저장한 링크입니다. 보관함에서 확인하세요.");
    }
  }

  function indexOf(id) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("저장 항목을 찾을 수 없습니다.");
    return index;
  }

  window.StoryStore = Object.freeze({
    ready,
    get storageMode() {
      return mode;
    },
    get errorMessage() {
      return storageError;
    },
    list() {
      return state.items.map(copyItem);
    },
    folders() {
      return [...state.folders];
    },
    add(data) {
      return mutate(() => {
        const item = normalizeItem(data);
        ensureFolder(item);
        ensureUniqueURL(item);
        state.items.unshift(item);
        return copyItem(item);
      });
    },
    update(id, patch) {
      return mutate(() => {
        const index = indexOf(id);
        const item = normalizeItem(patch, state.items[index]);
        ensureFolder(item);
        ensureUniqueURL(item, id);
        state.items[index] = item;
        return copyItem(item);
      });
    },
    remove(id) {
      return mutate(() => copyItem(state.items.splice(indexOf(id), 1)[0]));
    },
    restore(data) {
      return mutate(() => {
        const item = normalizeItem(data, null, true);
        if (state.items.some((other) => other.id === item.id))
          throw new Error("이미 복원된 항목입니다.");
        ensureUniqueURL(item);
        if (!state.folders.includes(item.folder))
          state.folders.push(item.folder);
        state.items.push(item);
        state.items.sort((a, b) => b.savedAt - a.savedAt);
        return copyItem(item);
      });
    },
    addFolder(name) {
      return mutate(() => {
        const normalized = folderName(name);
        if (
          state.folders.some(
            (folder) =>
              folder.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
          )
        )
          throw new Error("같은 이름의 폴더가 있습니다.");
        state.folders.push(normalized);
        return normalized;
      });
    },
    exportData() {
      return {
        version: SCHEMA_VERSION,
        app: "Storyge",
        exportedAt: new Date().toISOString(),
        items: state.items.map(copyItem),
        folders: [...state.folders],
      };
    },
  });
})();
