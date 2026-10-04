/** Storyge mobile model. Sample data is explicitly marked, never AI-generated results. */
export const PLATFORMS = [
  "스크린샷",
  "YouTube",
  "Instagram",
  "웹 링크",
] as const;
export type Platform = (typeof PLATFORMS)[number];
export type Clip = {
  id: string;
  title: string;
  url: string;
  imageKey?: string;
  imageUri?: string;
  platform: Platform;
  favorite: boolean;
  tags: string[];
  note: string;
  folderId: string;
  savedAt: number;
  sample: boolean;
};
export type Folder = { id: string; name: string };
export type ClipInput = Partial<Omit<Clip, "id" | "savedAt" | "sample">>;
export type ClipPatch = ClipInput;
export type LibraryData = { version: 1; items: Clip[]; folders: Folder[] };

// A single AsyncStorage 2.x value must stay safely below Android's CursorWindow limit.
export const MAX_LIBRARY_BYTES = 1.5 * 1024 * 1024;
export const MAX_IMAGE_URI_BYTES = Math.floor(1.2 * 1024 * 1024);

/** UTF-8 bytes, including Korean and surrogate pairs, without a Node-only Buffer API. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** Use for every write, not only image additions: metadata grows the same stored value. */
export function serializeLibrary(data: LibraryData): string {
  const serialized = JSON.stringify(data);
  if (utf8ByteLength(serialized) > MAX_LIBRARY_BYTES) {
    throw new Error(
      "모바일 시안의 기기 저장 한도(전체 1.5MiB)를 초과했습니다. 일부 항목을 삭제하거나 더 작은 이미지를 선택하세요.",
    );
  }
  return serialized;
}

export const IMAGE_KEYS = [
  "chair",
  "forest",
  "coffee",
  "style",
  "interior",
  "shoe",
  "lake",
  "perfume",
  "books",
] as const;
export const DEFAULT_FOLDERS: Folder[] = [
  { id: "interior", name: "공간 · 인테리어" },
  { id: "style", name: "패션 · 쇼핑" },
  { id: "travel", name: "여행 · 장소" },
  { id: "life", name: "일상 · 기타" },
  { id: "inbox", name: "미분류" },
];

const sampleRows: [string, string, Platform, string, string[], string][] = [
  [
    "chair",
    "원목 의자",
    "스크린샷",
    "interior",
    ["원목", "의자", "가구"],
    "1503602642458-232111445657",
  ],
  [
    "forest",
    "숲 사진",
    "Instagram",
    "travel",
    ["숲", "산책", "자연"],
    "1441974231531-c6227db76b6e",
  ],
  [
    "coffee",
    "라테 사진",
    "YouTube",
    "life",
    ["커피", "홈카페", "라테"],
    "1495474472287-4d71bcdd2085",
  ],
  [
    "style",
    "여름 의상",
    "Instagram",
    "style",
    ["옷", "여름", "스타일"],
    "1515886657613-9f3515b0c78f",
  ],
  [
    "interior",
    "거실 인테리어",
    "스크린샷",
    "interior",
    ["거실", "베이지", "조명"],
    "1600210492486-724fe5c67fb0",
  ],
  [
    "shoe",
    "스니커즈",
    "스크린샷",
    "style",
    ["신발", "스니커즈", "브라운"],
    "1549298916-b41d501d3772",
  ],
  [
    "lake",
    "호수와 산",
    "스크린샷",
    "travel",
    ["호수", "산", "여행"],
    "1470770841072-f978cf4d019e",
  ],
  [
    "perfume",
    "향수",
    "웹 링크",
    "style",
    ["향수", "선물"],
    "1541643600914-78b084683601",
  ],
  [
    "books",
    "데스크 조명",
    "웹 링크",
    "interior",
    ["조명", "책상", "인테리어"],
    "1494438639946-1ebd1d20bf85",
  ],
];

export const SAMPLE_CLIPS: Clip[] = sampleRows.map(
  ([imageKey, title, platform, folderId, tags, source], index) => ({
    id: `sample-${imageKey}`,
    title,
    platform,
    folderId,
    tags,
    imageKey,
    url: `https://images.unsplash.com/photo-${source}?auto=format&fit=crop&w=1600&q=85`,
    note: "",
    favorite: index === 0 || index === 6,
    savedAt: Date.UTC(2026, 9, 4, 3) - index * 86_400_000,
    sample: true,
  }),
);

export function cloneClip(item: Clip): Clip {
  return { ...item, tags: [...item.tags] };
}

export function initialLibrary(): LibraryData {
  return {
    version: 1,
    items: SAMPLE_CLIPS.map(cloneClip),
    folders: DEFAULT_FOLDERS.map((folder) => ({ ...folder })),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

function text(
  value: unknown,
  label: string,
  max: number,
  fallback = "",
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new Error(`${label} 형식을 확인하세요.`);
  const normalized = value.trim();
  if (normalized.length > max)
    throw new Error(`${label}은(는) ${max}자 이내로 입력하세요.`);
  return normalized;
}

/** Only http(s), without credentials. Returns an empty string for invalid input. */
export function safeURL(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192 || !value.trim())
    return "";
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizeURL(value: unknown): string {
  const raw = text(value, "링크", 8192);
  if (!raw) return "";
  const result = safeURL(raw);
  if (!result) throw new Error("http 또는 https로 시작하는 링크를 입력하세요.");
  return result;
}

export function urlKey(value: string): string {
  if (!value) return "";
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

export function inferPlatform(url: string, image?: string): Platform {
  if (url) {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "youtu.be" || /(^|\.)youtube\.com$/.test(hostname))
      return "YouTube";
    if (/(^|\.)instagram\.com$/.test(hostname)) return "Instagram";
    return "웹 링크";
  }
  return image ? "스크린샷" : "웹 링크";
}

function normalizeImage(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("이미지 형식을 확인하세요.");
  // Persist the image bytes; picker cache file URIs are not durable storage.
  if (
    /^data:image\/(?:png|jpeg|jpg|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(
      value,
    )
  ) {
    if (value.length > MAX_IMAGE_URI_BYTES)
      throw new Error(
        "이미지가 너무 큽니다. 모바일 시안에서는 약 900KB 이하의 이미지를 선택하세요.",
      );
    return value;
  }
  const url = safeURL(value);
  if (!url)
    throw new Error(
      "저장할 수 없는 이미지 형식입니다. 이미지를 다시 선택하세요.",
    );
  return url;
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20)
    throw new Error("키워드는 최대 20개까지 입력하세요.");
  return [
    ...new Set(value.map((tag) => text(tag, "키워드", 60)).filter(Boolean)),
  ];
}

export function normalizeFolderName(value: unknown): string {
  const name = text(value, "폴더 이름", 60);
  if (!name) throw new Error("폴더 이름을 입력하세요.");
  return name;
}

export function makeID(prefix = "clip"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Validate user additions/edits. Only trusted persisted records may supply identity/sample flags. */
export function prepareClip(
  data: ClipInput,
  folders: Folder[],
  existing?: Clip,
  trusted = false,
): Clip {
  if (!isRecord(data)) throw new Error("저장 항목 형식을 확인하세요.");
  const value = (key: keyof Clip) =>
    own(data, key) ? (data as Record<string, unknown>)[key] : existing?.[key];
  const url = normalizeURL(value("url"));
  const imageUri = normalizeImage(value("imageUri"));
  const key = text(value("imageKey"), "이미지", 40);
  if (key && !IMAGE_KEYS.includes(key as (typeof IMAGE_KEYS)[number]))
    throw new Error("알 수 없는 이미지입니다.");
  const imageKey = key || undefined;
  if (!url && !imageUri && !imageKey)
    throw new Error("링크 또는 이미지를 추가하세요.");
  const platformValue =
    value("platform") || inferPlatform(url, imageUri || imageKey);
  if (!PLATFORMS.includes(platformValue as Platform))
    throw new Error("지원하지 않는 플랫폼입니다.");
  const platform = platformValue as Platform;
  if (!url && platform !== "스크린샷")
    throw new Error("원본 링크를 입력하세요.");
  const fallback = url
    ? new URL(url).hostname.replace(/^www\./, "")
    : "스크린샷";
  const title = text(value("title"), "제목", 200, fallback) || fallback;
  const folderId = text(value("folderId"), "폴더", 120, "inbox") || "inbox";
  if (!folders.some((folder) => folder.id === folderId))
    throw new Error("폴더를 찾을 수 없습니다. 다른 폴더를 선택하세요.");
  const favorite = value("favorite") ?? false;
  if (typeof favorite !== "boolean")
    throw new Error("즐겨찾기 형식을 확인하세요.");
  let id = existing?.id || makeID();
  let savedAt = existing?.savedAt ?? Date.now();
  let sample = existing?.sample ?? false;
  if (trusted) {
    id = text(value("id"), "항목 ID", 120);
    savedAt = value("savedAt") as number;
    sample = value("sample") as boolean;
    if (
      !id ||
      !Number.isFinite(savedAt) ||
      savedAt < 0 ||
      typeof sample !== "boolean"
    )
      throw new Error("저장 데이터 형식이 올바르지 않습니다.");
  }
  return {
    id,
    title,
    url,
    ...(imageKey ? { imageKey } : {}),
    ...(imageUri ? { imageUri } : {}),
    platform,
    favorite,
    tags: normalizeTags(value("tags")),
    note: text(value("note"), "메모", 4000),
    folderId,
    savedAt,
    sample,
  };
}

export function assertUniqueURL(items: Clip[], clip: Clip): void {
  const key = urlKey(clip.url);
  if (
    key &&
    items.some(
      (item) => item.id !== clip.id && item.url && urlKey(item.url) === key,
    )
  ) {
    throw new Error("이미 저장한 링크입니다. 보관함에서 확인하세요.");
  }
}

export function parseStoredLibrary(raw: string): LibraryData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "저장 데이터를 읽을 수 없습니다. 기존 데이터는 변경하지 않았습니다.",
    );
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.items) ||
    !Array.isArray(parsed.folders)
  ) {
    throw new Error(
      "지원하지 않는 저장 데이터입니다. 기존 데이터는 변경하지 않았습니다.",
    );
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  const folders = parsed.folders.map((value) => {
    if (!isRecord(value))
      throw new Error("저장된 폴더 정보가 올바르지 않습니다.");
    const id = text(value.id, "폴더 ID", 120);
    const name = normalizeFolderName(value.name);
    const normalizedName = name.normalize("NFKC").toLocaleLowerCase();
    if (!id || ids.has(id) || names.has(normalizedName))
      throw new Error("중복된 폴더 정보가 있습니다.");
    ids.add(id);
    names.add(normalizedName);
    return { id, name };
  });
  if (!ids.has("inbox"))
    throw new Error(
      "미분류 폴더를 찾을 수 없습니다. 기존 데이터는 변경하지 않았습니다.",
    );
  const clipIDs = new Set<string>();
  const items = parsed.items.map((value) => {
    const clip = prepareClip(value, folders, undefined, true);
    if (clipIDs.has(clip.id)) throw new Error("중복된 저장 항목이 있습니다.");
    clipIDs.add(clip.id);
    return clip;
  });
  return { version: 1, items, folders };
}

export type ClipFilter = {
  query?: string;
  platform?: Platform | "전체";
  folderId?: string;
  favorite?: boolean;
  sort?: "newest" | "oldest" | "new" | "old" | "title";
};

/** Literal keyword search only. Does not claim embedding/RAG/semantic search. */
export function filterClips(items: Clip[], filter: ClipFilter = {}): Clip[] {
  const normalize = (value: string) =>
    value.normalize("NFKC").toLocaleLowerCase();
  const terms = normalize(filter.query || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return items
    .filter((item) => {
      if (filter.folderId && filter.folderId !== item.folderId) return false;
      if (
        filter.platform &&
        filter.platform !== "전체" &&
        filter.platform !== item.platform
      )
        return false;
      if (filter.favorite && !item.favorite) return false;
      const searchable = normalize(
        [item.title, item.note, item.url, ...item.tags].join(" "),
      );
      return terms.every((term) => searchable.includes(term));
    })
    .map(cloneClip)
    .sort((a, b) => {
      if (filter.sort === "title") return a.title.localeCompare(b.title, "ko");
      if (filter.sort === "oldest" || filter.sort === "old")
        return a.savedAt - b.savedAt || a.id.localeCompare(b.id);
      return b.savedAt - a.savedAt || a.id.localeCompare(b.id);
    });
}
