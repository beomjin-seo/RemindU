import assert from "node:assert/strict";
import test from "node:test";
import {
  assertUniqueURL,
  DEFAULT_FOLDERS,
  filterClips,
  initialLibrary,
  MAX_IMAGE_URI_BYTES,
  MAX_LIBRARY_BYTES,
  normalizeFolderName,
  parseStoredLibrary,
  prepareClip,
  safeURL,
  SAMPLE_CLIPS,
  serializeLibrary,
  utf8ByteLength,
} from "./model";

test("safe URLs exclude executable schemes, credentials, and incomplete input", () => {
  assert.equal(
    safeURL(" https://example.com/path?q=한글 "),
    "https://example.com/path?q=%ED%95%9C%EA%B8%80",
  );
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/photo.jpg",
    "data:text/html,test",
    "https://user:pass@example.com",
    "example.com",
    null,
  ])
    assert.equal(safeURL(url), "");
});

test("new clips validate input, infer platform and cannot forge sample identity", () => {
  const clip = prepareClip(
    {
      url: "https://youtu.be/example",
      title: "  예시 영상  ",
      tags: ["영상", "영상", "  "],
    },
    DEFAULT_FOLDERS,
  );
  assert.equal(clip.platform, "YouTube");
  assert.equal(clip.title, "예시 영상");
  assert.equal(clip.folderId, "inbox");
  assert.equal(clip.sample, false);
  assert.deepEqual(clip.tags, ["영상"]);
  assert.throws(() =>
    prepareClip({ url: "javascript:alert(1)" }, DEFAULT_FOLDERS),
  );
  assert.throws(() => prepareClip({}, DEFAULT_FOLDERS));
  assert.throws(() =>
    prepareClip(
      { url: "https://example.com", folderId: "missing" },
      DEFAULT_FOLDERS,
    ),
  );
  assert.throws(() =>
    prepareClip({ imageUri: "file:///temporary/picker.jpg" }, DEFAULT_FOLDERS),
  );
  assert.throws(() =>
    prepareClip(
      { imageUri: "data:image/svg+xml;base64,PHN2Zz4=" },
      DEFAULT_FOLDERS,
    ),
  );
});

test("a persistent raster image can be saved without fabricating a source", () => {
  const clip = prepareClip(
    { imageUri: "data:image/jpeg;base64,YWJj", title: "제품 이미지" },
    DEFAULT_FOLDERS,
  );
  assert.equal(clip.platform, "스크린샷");
  assert.equal(clip.url, "");
  assert.equal(clip.imageUri, "data:image/jpeg;base64,YWJj");
  assert.equal(clip.sample, false);
});

test("edits preserve identity, sample marker and original save time", () => {
  const before = SAMPLE_CLIPS[0];
  const after = prepareClip(
    { title: "바뀐 제목", favorite: false, note: "메모" },
    DEFAULT_FOLDERS,
    before,
  );
  assert.equal(after.id, before.id);
  assert.equal(after.savedAt, before.savedAt);
  assert.equal(after.sample, true);
  assert.equal(after.imageKey, before.imageKey);
  assert.equal(after.note, "메모");
  assert.equal(before.title, "원목 의자");
});

test("duplicate URLs ignore fragments but preserve query parameters", () => {
  const before = prepareClip(
    { url: "https://example.com/a#first" },
    DEFAULT_FOLDERS,
  );
  const duplicate = prepareClip(
    { url: "https://example.com/a#second" },
    DEFAULT_FOLDERS,
  );
  assert.throws(() => assertUniqueURL([before], duplicate), /이미 저장/);
  assert.doesNotThrow(() => assertUniqueURL([before], before));
  assert.doesNotThrow(() =>
    assertUniqueURL(
      [before],
      prepareClip({ url: "https://example.com/a?page=2" }, DEFAULT_FOLDERS),
    ),
  );
});

test("search combines literal terms and filters without mutating stored data", () => {
  assert.equal(
    filterClips(SAMPLE_CLIPS, { query: "원목 가구" })[0].id,
    "sample-chair",
  );
  assert.equal(
    filterClips(SAMPLE_CLIPS, { platform: "스크린샷", folderId: "travel" })[0]
      .id,
    "sample-lake",
  );
  assert.equal(filterClips(SAMPLE_CLIPS, { favorite: true }).length, 2);
  assert.equal(
    filterClips(SAMPLE_CLIPS, { query: "not-present-anywhere" }).length,
    0,
  );
  const oldest = filterClips(SAMPLE_CLIPS, { sort: "oldest" });
  assert.equal(oldest[0].id, "sample-books");
  oldest[0].tags.push("mutation");
  assert.ok(!SAMPLE_CLIPS[8].tags.includes("mutation"));
});

test("storage roundtrip preserves empty libraries and rejects corrupt schemas", () => {
  const fresh = initialLibrary();
  assert.deepEqual(parseStoredLibrary(JSON.stringify(fresh)), fresh);
  assert.equal(
    parseStoredLibrary(JSON.stringify({ ...fresh, items: [] })).items.length,
    0,
  );
  assert.throws(() => parseStoredLibrary("{broken"));
  assert.throws(() =>
    parseStoredLibrary(JSON.stringify({ ...fresh, version: 99 })),
  );
  assert.throws(() =>
    parseStoredLibrary(
      JSON.stringify({ ...fresh, items: [...fresh.items, fresh.items[0]] }),
    ),
  );
  assert.throws(() =>
    parseStoredLibrary(
      JSON.stringify({
        ...fresh,
        folders: fresh.folders.filter((folder) => folder.id !== "inbox"),
      }),
    ),
  );
  assert.throws(() =>
    parseStoredLibrary(
      JSON.stringify({
        ...fresh,
        folders: [...fresh.folders, { id: "duplicate", name: "미분류" }],
      }),
    ),
  );
});

test("folder and text limits are validated", () => {
  assert.equal(normalizeFolderName("  북마크  "), "북마크");
  assert.throws(() => normalizeFolderName(" "));
  assert.throws(() => normalizeFolderName("가".repeat(61)));
  assert.throws(() =>
    prepareClip(
      { url: "https://example.com", title: "가".repeat(201) },
      DEFAULT_FOLDERS,
    ),
  );
  assert.throws(() =>
    prepareClip(
      { url: "https://example.com", note: "가".repeat(4001) },
      DEFAULT_FOLDERS,
    ),
  );
  assert.throws(() =>
    prepareClip(
      {
        url: "https://example.com",
        tags: Array.from({ length: 21 }, (_, i) => String(i)),
      },
      DEFAULT_FOLDERS,
    ),
  );
});

test("UTF-8 count handles Korean, emoji, and lone surrogate replacement", () => {
  for (const value of [
    "",
    "ASCII",
    "가나다",
    "가😀a",
    "\ud800",
    "\udc00",
    "\ud800a",
  ]) {
    assert.equal(utf8ByteLength(value), Buffer.byteLength(value, "utf8"));
  }
  assert.equal(utf8ByteLength("가나다"), 9);
});

test("serialized total guard uses Korean byte count and accepts the exact boundary", () => {
  const data = initialLibrary();
  const overhead = utf8ByteLength(JSON.stringify(data));
  const remaining = MAX_LIBRARY_BYTES - overhead;
  data.items[0].note =
    "가".repeat(Math.floor(remaining / 3)) + "a".repeat(remaining % 3);
  const serialized = serializeLibrary(data);
  assert.equal(utf8ByteLength(serialized), MAX_LIBRARY_BYTES);
  data.items[0].note += "a";
  assert.throws(() => serializeLibrary(data), /전체 1\.5MiB/);
});

test("individual image guard rejects excessive base64 before storage", () => {
  const prefix = "data:image/jpeg;base64,";
  const valid = prefix + "A".repeat(MAX_IMAGE_URI_BYTES - prefix.length);
  assert.doesNotThrow(() => prepareClip({ imageUri: valid }, DEFAULT_FOLDERS));
  assert.throws(
    () => prepareClip({ imageUri: valid + "A" }, DEFAULT_FOLDERS),
    /900KB/,
  );
});

test("multiple individually valid images cannot exceed the shared storage limit", () => {
  const first = prepareClip(
    { imageUri: "data:image/jpeg;base64," + "A".repeat(800 * 1024) },
    DEFAULT_FOLDERS,
  );
  const second = prepareClip(
    { imageUri: "data:image/png;base64," + "B".repeat(800 * 1024) },
    DEFAULT_FOLDERS,
  );
  const data = initialLibrary();
  data.items.push(first);
  assert.doesNotThrow(() => serializeLibrary(data));
  data.items.push(second);
  assert.throws(() => serializeLibrary(data), /기기 저장 한도/);
  data.items.pop();
  assert.doesNotThrow(() => serializeLibrary(data));
});
