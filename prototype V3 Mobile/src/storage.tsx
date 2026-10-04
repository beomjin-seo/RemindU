import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  assertUniqueURL,
  cloneClip,
  initialLibrary,
  makeID,
  normalizeFolderName,
  parseStoredLibrary,
  prepareClip,
  serializeLibrary,
  type Clip,
  type ClipInput,
  type ClipPatch,
  type Folder,
  type LibraryData,
} from "./model";

// Intentionally separate from all web and earlier prototype storage.
const STORAGE_KEY = "@storyge/mobile-v3/library-v1";

type LibraryContextValue = {
  items: Clip[];
  folders: Folder[];
  ready: boolean;
  error: string | null;
  retry: () => Promise<void>;
  add: (input: ClipInput) => Promise<Clip>;
  update: (id: string, patch: ClipPatch) => Promise<Clip>;
  remove: (id: string) => Promise<Clip>;
  restore: (clip: Clip) => Promise<void>;
  addFolder: (name: string) => Promise<Folder>;
};

const LibraryContext = createContext<LibraryContextValue | null>(null);
const copyData = (data: LibraryData): LibraryData => ({
  version: 1,
  items: data.items.map(cloneClip),
  folders: data.folders.map((folder) => ({ ...folder })),
});
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "저장할 수 없습니다. 다시 시도하세요.";

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LibraryData>({
    version: 1,
    items: [],
    folders: [],
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(data);
  const readyRef = useRef(false);
  const blocked = useRef<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  const initializing = useRef<Promise<void> | null>(null);

  async function loadLibrary(): Promise<void> {
    readyRef.current = false;
    if (alive.current) setReady(false);
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const next = raw === null ? initialLibrary() : parseStoredLibrary(raw);
      // Seed once. A legitimately emptied library is never reseeded.
      if (raw === null)
        await AsyncStorage.setItem(STORAGE_KEY, serializeLibrary(next));
      current.current = next;
      blocked.current = null;
      if (alive.current) {
        setData(copyData(next));
        setError(null);
      }
    } catch (caught) {
      blocked.current = `기기 저장소를 불러오지 못했습니다. ${message(caught)}`;
      if (alive.current) setError(blocked.current);
      throw new Error(blocked.current);
    } finally {
      readyRef.current = true;
      if (alive.current) setReady(true);
    }
  }

  useEffect(() => {
    alive.current = true;
    // Keep one hydration even when React Strict Mode repeats effect setup.
    if (!initializing.current) {
      initializing.current = loadLibrary().catch(() => undefined);
    }
    return () => {
      alive.current = false;
    };
  }, []);

  function retry(): Promise<void> {
    // Queue retry behind writes; subsequent mutations wait for this read to finish.
    // Keep the initial hydration gate unchanged to avoid a circular queue wait.
    const pending = queue.current.then(async () => {
      if (initializing.current) await initializing.current;
      await loadLibrary();
    });
    queue.current = pending.catch(() => undefined);
    return pending;
  }

  function mutate<T>(operation: (next: LibraryData) => T): Promise<T> {
    const pending = queue.current.then(async () => {
      if (initializing.current) await initializing.current;
      if (!readyRef.current)
        throw new Error("보관함을 불러오는 중입니다. 잠시 후 다시 시도하세요.");
      if (blocked.current) throw new Error(blocked.current);
      const next = copyData(current.current);
      const result = operation(next);
      // Guard the total UTF-8 payload before touching disk, for every operation.
      const serialized = serializeLibrary(next);
      try {
        await AsyncStorage.setItem(STORAGE_KEY, serialized);
      } catch {
        throw new Error(
          "기기에 저장하지 못했습니다. 변경 전 데이터는 유지됩니다. 저장 공간을 확인하고 다시 시도하세요.",
        );
      }
      // Publish only after disk write succeeds; rapid actions are serialized.
      current.current = next;
      if (alive.current) {
        setData(copyData(next));
        setError(null);
      }
      return result;
    });
    queue.current = pending.catch(() => undefined);
    return pending.catch((caught) => {
      if (alive.current) setError(message(caught));
      throw caught;
    });
  }

  const api: LibraryContextValue = {
    items: data.items,
    folders: data.folders,
    ready,
    error,
    retry,
    add: (input) =>
      mutate((next) => {
        const clip = prepareClip(input, next.folders);
        assertUniqueURL(next.items, clip);
        next.items.unshift(clip);
        return cloneClip(clip);
      }),
    update: (id, patch) =>
      mutate((next) => {
        const index = next.items.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("저장 항목을 찾을 수 없습니다.");
        const clip = prepareClip(patch, next.folders, next.items[index]);
        assertUniqueURL(next.items, clip);
        next.items[index] = clip;
        return cloneClip(clip);
      }),
    remove: (id) =>
      mutate((next) => {
        const index = next.items.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("저장 항목을 찾을 수 없습니다.");
        return cloneClip(next.items.splice(index, 1)[0]);
      }),
    restore: (clip) =>
      mutate((next) => {
        if (next.items.some((item) => item.id === clip.id))
          throw new Error("이미 복원된 항목입니다.");
        const restored = prepareClip(clip, next.folders, undefined, true);
        assertUniqueURL(next.items, restored);
        next.items.push(restored);
        next.items.sort((a, b) => b.savedAt - a.savedAt);
      }),
    addFolder: (name) =>
      mutate((next) => {
        const normalized = normalizeFolderName(name);
        if (
          next.folders.some(
            (folder) =>
              folder.name.normalize("NFKC").toLocaleLowerCase() ===
              normalized.normalize("NFKC").toLocaleLowerCase(),
          )
        ) {
          throw new Error("같은 이름의 폴더가 있습니다.");
        }
        const folder = { id: makeID("folder"), name: normalized };
        next.folders.push(folder);
        return { ...folder };
      }),
  };

  return (
    <LibraryContext.Provider value={api}>{children}</LibraryContext.Provider>
  );
}

export function useLibrary(): LibraryContextValue {
  const context = useContext(LibraryContext);
  if (!context)
    throw new Error("useLibrary는 LibraryProvider 안에서 사용하세요.");
  return context;
}
