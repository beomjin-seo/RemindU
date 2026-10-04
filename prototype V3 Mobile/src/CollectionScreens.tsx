import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
  type ListRenderItemInfo,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Bookmark,
  Check,
  ChevronDown,
  Folder as FolderIcon,
  FolderPlus,
  Image as ImageIcon,
  Search,
  SearchX,
  X,
} from "lucide-react-native";
import { useLibrary } from "./storage";
import { imageSource } from "./assets";
import type { Clip, Folder } from "./model";
import { filterClips } from "./model";
import { colors } from "./theme";
import { Header, IconButton, PressableScale } from "./ui";
import Sheet from "./Sheet";

type OpenClip = (id: string) => void;
type BaseProps = { onOpen: OpenClip; onAdd: () => void; onInfo: () => void };
type Sort = "newest" | "oldest" | "title";
const sortLabels: Record<Sort, string> = {
  newest: "최신순",
  oldest: "오래된순",
  title: "제목순",
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "다시 시도해 주세요.";
const timestamp = (clip: Clip) => new Date(clip.savedAt).getTime() || 0;

function sorted(items: Clip[], sort: Sort): Clip[] {
  return [...items].sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title, "ko")
      : sort === "newest"
        ? timestamp(b) - timestamp(a)
        : timestamp(a) - timestamp(b),
  );
}

function dateLabel(clip: Clip): string {
  const date = new Date(clip.savedAt);
  return Number.isNaN(date.getTime())
    ? ""
    : `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, "0")}`;
}

function ItemImage({ item, style }: { item: Clip; style: object }) {
  const [failed, setFailed] = useState(false);
  const source = imageSource(item) as ImageSourcePropType | undefined;
  return source && !failed ? (
    <Image
      source={source}
      style={style}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessible={false}
    />
  ) : (
    <View style={[style, styles.imagePlaceholder]}>
      <ImageIcon size={30} color={colors.muted} strokeWidth={1.2} />
    </View>
  );
}

function EmptyState({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <SearchX size={34} color={colors.muted} strokeWidth={1.25} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action && onAction && (
        <PressableScale
          onPress={onAction}
          style={styles.emptyButton}
          accessibilityRole="button"
          accessibilityLabel={action}
        >
          <Text style={styles.emptyButtonText}>{action}</Text>
        </PressableScale>
      )}
    </View>
  );
}

function LoadingState() {
  return (
    <View style={styles.empty} accessibilityLabel="저장 항목 불러오는 중">
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.emptyBody}>저장 항목을 불러오는 중</Text>
    </View>
  );
}

function StorageNotice() {
  const { error, retry } = useLibrary();
  const [retrying, setRetrying] = useState(false);
  const pending = useRef(false);
  const reload = async () => {
    if (pending.current) return;
    pending.current = true;
    setRetrying(true);
    try {
      await retry();
    } catch (caught) {
      Alert.alert("다시 불러오지 못했습니다", message(caught));
    } finally {
      pending.current = false;
      setRetrying(false);
    }
  };
  if (!error) return null;
  return (
    <View style={styles.storageNotice} accessibilityRole="alert">
      <Text style={styles.storageNoticeText}>
        {typeof error === "string"
          ? error
          : "기기 저장소를 사용할 수 없습니다. 앱을 닫기 전에 확인해 주세요."}
      </Text>
      <Pressable
        onPress={reload}
        disabled={retrying}
        accessibilityRole="button"
        accessibilityLabel="저장 데이터 다시 불러오기"
        accessibilityState={{ disabled: retrying, busy: retrying }}
        style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
      >
        {retrying && <ActivityIndicator size="small" color={colors.accent} />}
        <Text style={styles.retryText}>
          {retrying ? "불러오는 중" : "다시 불러오기"}
        </Text>
      </Pressable>
    </View>
  );
}

function ClipCard({ item, onOpen }: { item: Clip; onOpen: OpenClip }) {
  const { update } = useLibrary();
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const toggleFavorite = async () => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      await update(item.id, { favorite: !item.favorite });
    } catch (error) {
      Alert.alert("즐겨찾기를 변경하지 못했어요", message(error));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <View style={styles.card}>
      <PressableScale
        onPress={() => onOpen(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${item.platform}${item.sample ? ", 샘플" : ""}`}
        style={styles.cardPress}
      >
        <View style={styles.cardImageWrap}>
          <ItemImage item={item} style={styles.cardImage} />
          <View style={styles.platformPill} pointerEvents="none">
            <Text style={styles.platformText} numberOfLines={1}>
              {item.platform}
              {item.sample ? " · 샘플" : ""}
            </Text>
          </View>
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <View style={styles.cardMeta}>
          <Text style={styles.cardMetaText} numberOfLines={1}>
            {item.tags?.slice(0, 2).join(" · ") || "저장 항목"}
          </Text>
          <Text style={styles.cardDate}>{dateLabel(item)}</Text>
        </View>
      </PressableScale>
      <Pressable
        onPress={toggleFavorite}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel={`${item.title} 즐겨찾기 ${item.favorite ? "해제" : "추가"}`}
        accessibilityState={{ selected: item.favorite, disabled: saving }}
        style={({ pressed }) => [styles.favorite, pressed && styles.pressed]}
      >
        <View style={styles.favoriteDisc}>
          <Bookmark
            size={16}
            color="#ffffff"
            fill={item.favorite ? "#ffffff" : "transparent"}
            strokeWidth={1.7}
          />
        </View>
      </Pressable>
    </View>
  );
}

export function ClipGrid({
  items,
  onOpen,
  header,
}: {
  items: Clip[];
  onOpen: OpenClip;
  header?: React.ReactNode;
}) {
  return (
    <FlatList
      data={items}
      numColumns={2}
      keyExtractor={(item) => item.id}
      renderItem={({ item }: ListRenderItemInfo<Clip>) => (
        <ClipCard item={item} onOpen={onOpen} />
      )}
      style={styles.flex}
      contentContainerStyle={styles.gridContent}
      columnWrapperStyle={styles.gridRow}
      ListHeaderComponent={header ? <View>{header}</View> : null}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ListEmptyComponent={
        <EmptyState
          title="저장 항목이 없어요"
          body="상단의 추가 버튼으로 링크나 이미지를 저장하세요."
        />
      }
      initialNumToRender={10}
      maxToRenderPerBatch={8}
      windowSize={7}
    />
  );
}

function SortModal({
  value,
  onSelect,
  onClose,
}: {
  value: Sort;
  onSelect: (sort: Sort) => void;
  onClose: () => void;
}) {
  const [closeRequested, setCloseRequested] = useState(false);
  return (
    <Sheet title="정렬" onClose={onClose} closeRequested={closeRequested}>
      {(["newest", "oldest", "title"] as Sort[]).map((sort) => (
        <Pressable
          key={sort}
          accessibilityRole="radio"
          accessibilityState={{
            checked: value === sort,
            disabled: closeRequested,
          }}
          disabled={closeRequested}
          onPress={() => {
            onSelect(sort);
            setCloseRequested(true);
          }}
          style={({ pressed }) => [
            styles.sortOption,
            value === sort && styles.sortOptionSelected,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.sortOptionText}>{sortLabels[sort]}</Text>
          {value === sort && <Check size={20} color={colors.accent} />}
        </Pressable>
      ))}
    </Sheet>
  );
}

function CollectionControls({
  platforms,
  platform,
  onPlatform,
  favorite,
  onFavorite,
  count,
  sort,
  onSort,
}: {
  platforms: string[];
  platform: string;
  onPlatform: (value: string) => void;
  favorite: boolean;
  onFavorite: () => void;
  count: number;
  sort: Sort;
  onSort: () => void;
}) {
  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filters}
      >
        {["전체", ...platforms].map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: platform === value }}
            onPress={() => onPlatform(value)}
            style={({ pressed }) => [
              styles.filter,
              platform === value && styles.filterSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.filterText,
                platform === value && styles.filterTextSelected,
              ]}
            >
              {value}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.collectionTools}>
        <Text style={styles.resultCount}>{count}개 항목</Text>
        <View style={styles.toolsRight}>
          <Pressable
            onPress={onFavorite}
            accessibilityRole="button"
            accessibilityLabel="즐겨찾기만 보기"
            accessibilityState={{ selected: favorite }}
            style={({ pressed }) => [
              styles.favoriteFilter,
              favorite && styles.favoriteFilterActive,
              pressed && styles.pressed,
            ]}
          >
            <Bookmark
              size={16}
              color={favorite ? colors.accent : colors.muted}
              fill={favorite ? colors.accent : "transparent"}
            />
          </Pressable>
          <Pressable
            onPress={onSort}
            accessibilityRole="button"
            accessibilityLabel={`정렬: ${sortLabels[sort]}`}
            style={({ pressed }) => [
              styles.sortButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.sortLabel}>{sortLabels[sort]}</Text>
            <ChevronDown size={14} color={colors.muted} />
          </Pressable>
        </View>
      </View>
    </>
  );
}

function CollectionBody({
  source,
  onOpen,
}: {
  source: Clip[];
  onOpen: OpenClip;
}) {
  const [platform, setPlatform] = useState("전체");
  const [favorite, setFavorite] = useState(false);
  const [sort, setSort] = useState<Sort>("newest");
  const [sortOpen, setSortOpen] = useState(false);
  const platforms = useMemo(
    () => Array.from(new Set(source.map((item) => item.platform))),
    [source],
  );
  const activePlatform =
    platform === "전체" || platforms.includes(platform as Clip["platform"])
      ? platform
      : "전체";
  const items = useMemo(
    () =>
      sorted(
        source.filter(
          (item) =>
            (activePlatform === "전체" || item.platform === activePlatform) &&
            (!favorite || item.favorite),
        ),
        sort,
      ),
    [source, activePlatform, favorite, sort],
  );
  const clearFilters = () => {
    setPlatform("전체");
    setFavorite(false);
  };
  const controls = (
    <>
      <StorageNotice />
      <CollectionControls
        platforms={platforms}
        platform={activePlatform}
        onPlatform={setPlatform}
        favorite={favorite}
        onFavorite={() => setFavorite((v) => !v)}
        count={items.length}
        sort={sort}
        onSort={() => setSortOpen(true)}
      />
    </>
  );
  return (
    <View style={styles.flex}>
      {items.length || source.length === 0 ? (
        <ClipGrid items={items} onOpen={onOpen} header={controls} />
      ) : (
        <ScrollView contentContainerStyle={styles.gridContent}>
          {controls}
          <EmptyState
            title="조건에 맞는 항목이 없어요"
            body="다른 플랫폼을 선택하거나 필터를 해제하세요."
            action="필터 해제"
            onAction={clearFilters}
          />
        </ScrollView>
      )}
      {sortOpen && (
        <SortModal
          value={sort}
          onSelect={setSort}
          onClose={() => setSortOpen(false)}
        />
      )}
    </View>
  );
}

export function LibraryScreen({ onOpen, onAdd, onInfo }: BaseProps) {
  const { items, ready } = useLibrary();
  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <Header title="보관함" onAdd={onAdd} onInfo={onInfo} />
      {ready ? (
        <CollectionBody source={items} onOpen={onOpen} />
      ) : (
        <LoadingState />
      )}
    </SafeAreaView>
  );
}

function NewFolderModal({ onClose }: { onClose: () => void }) {
  const { addFolder } = useLibrary();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [closeRequested, setCloseRequested] = useState(false);
  const pending = useRef(false);
  const close = () => {
    if (!pending.current) {
      setName("");
      setError("");
      onClose();
    }
  };
  const save = async () => {
    if (pending.current || closeRequested) return;
    const clean = name.trim();
    if (!clean) {
      setError("폴더 이름을 입력하세요.");
      return;
    }
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await addFolder(clean);
      setCloseRequested(true);
    } catch (err) {
      setError(message(err));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <Sheet
      title="새 폴더"
      onClose={close}
      busy={saving}
      closeRequested={closeRequested}
    >
      <Text style={styles.inputLabel}>폴더 이름</Text>
      <TextInput
        value={name}
        onChangeText={(text) => {
          setName(text);
          setError("");
        }}
        placeholder="예: 다음 여행"
        placeholderTextColor={colors.muted}
        style={styles.folderInput}
        autoFocus
        maxLength={60}
        returnKeyType="done"
        onSubmitEditing={save}
        editable={!saving && !closeRequested}
        accessibilityLabel="폴더 이름"
      />
      {!!error && (
        <Text style={styles.fieldError} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Pressable
        onPress={save}
        disabled={saving || closeRequested || !name.trim()}
        accessibilityRole="button"
        accessibilityState={{
          disabled: saving || closeRequested || !name.trim(),
          busy: saving,
        }}
        style={({ pressed }) => [
          styles.saveFolder,
          (!name.trim() || saving) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {saving ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={styles.saveFolderText}>폴더 만들기</Text>
        )}
      </Pressable>
    </Sheet>
  );
}

function FolderCard({
  folder,
  items,
  onPress,
}: {
  folder: Folder;
  items: Clip[];
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      style={styles.folderCard}
      accessibilityRole="button"
      accessibilityLabel={`${folder.name}, ${items.length}개 항목`}
    >
      <View style={styles.folderCover}>
        {items.length > 0 ? (
          <>
            <ItemImage item={items[0]} style={styles.folderMainImage} />
            {items.length > 1 && (
              <View style={styles.folderSubImages}>
                <ItemImage item={items[1]} style={styles.folderSubImage} />
                {items.length > 2 && (
                  <ItemImage item={items[2]} style={styles.folderSubImage} />
                )}
              </View>
            )}
          </>
        ) : (
          <FolderIcon size={36} color={colors.muted} strokeWidth={1.15} />
        )}
      </View>
      <Text style={styles.folderName} numberOfLines={1}>
        {folder.name}
      </Text>
      <Text style={styles.folderCount}>{items.length}개 항목</Text>
    </PressableScale>
  );
}

export function FoldersScreen({
  onFolder,
  onAdd,
  onInfo,
}: {
  onFolder: (folderId: string) => void;
  onAdd: () => void;
  onInfo: () => void;
}) {
  const { folders, items, ready } = useLibrary();
  const [creating, setCreating] = useState(false);
  const folderItems = useMemo(
    () =>
      new Map(
        folders.map((folder) => [
          folder.id,
          sorted(
            items.filter((item) => item.folderId === folder.id),
            "newest",
          ),
        ]),
      ),
    [folders, items],
  );
  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <Header title="폴더" onAdd={onAdd} onInfo={onInfo} />
      {ready ? (
        <FlatList
          data={folders}
          numColumns={2}
          keyExtractor={(folder) => folder.id}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              <StorageNotice />
              <View style={styles.folderToolbar}>
                <Text style={styles.resultCount}>{folders.length}개 폴더</Text>
                <Pressable
                  onPress={() => setCreating(true)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.newFolderButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <FolderPlus size={18} color={colors.accent} />
                  <Text style={styles.newFolderLabel}>새 폴더</Text>
                </Pressable>
              </View>
            </>
          }
          renderItem={({ item }) => (
            <FolderCard
              folder={item}
              items={folderItems.get(item.id) || []}
              onPress={() => onFolder(item.id)}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              title="폴더를 만들어 보세요"
              body="저장 항목을 원하는 주제별로 모을 수 있어요."
              action="새 폴더"
              onAction={() => setCreating(true)}
            />
          }
        />
      ) : (
        <LoadingState />
      )}
      {creating && <NewFolderModal onClose={() => setCreating(false)} />}
    </SafeAreaView>
  );
}

export function FolderScreen({
  folderId,
  onBack,
  onOpen,
  onAdd,
}: {
  folderId: string;
  onBack: () => void;
  onOpen: OpenClip;
  onAdd: () => void;
}) {
  const { items, folders, ready } = useLibrary();
  const folder = folders.find((item) => item.id === folderId);
  const source = useMemo(
    () => items.filter((item) => item.folderId === folderId),
    [items, folderId],
  );
  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <Header title={folder?.name || "폴더"} onBack={onBack} onAdd={onAdd} />
      {!ready ? (
        <LoadingState />
      ) : !folder ? (
        <EmptyState
          title="폴더를 찾을 수 없어요"
          body="전체 폴더에서 다시 선택하세요."
          action="전체 폴더"
          onAction={onBack}
        />
      ) : (
        <CollectionBody source={source} onOpen={onOpen} />
      )}
    </SafeAreaView>
  );
}

export function SearchScreen({ onOpen, onAdd, onInfo }: BaseProps) {
  const { items, ready } = useLibrary();
  const [query, setQuery] = useState("");
  const input = useRef<TextInput>(null);
  const search = query.trim().toLocaleLowerCase();
  const found = useMemo(
    () => filterClips(items, { query: search, sort: "newest" }),
    [items, search],
  );
  const tags = useMemo(
    () => Array.from(new Set(items.flatMap((item) => item.tags))).slice(0, 8),
    [items],
  );
  const searchField = (
    <>
      <StorageNotice />
      <View style={styles.searchField}>
        <Search size={21} color={colors.muted} strokeWidth={1.6} />
        <TextInput
          ref={input}
          value={query}
          onChangeText={setQuery}
          placeholder="제목, 태그, 메모 검색"
          placeholderTextColor={colors.muted}
          accessibilityLabel="저장 항목 검색"
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {!!query && (
          <IconButton
            icon={X}
            onPress={() => {
              setQuery("");
              input.current?.focus();
            }}
            label="검색어 지우기"
          />
        )}
      </View>
    </>
  );
  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <Header title="검색" onAdd={onAdd} onInfo={onInfo} />
      {!ready ? (
        <LoadingState />
      ) : (
        <FlatList
          data={search ? found : []}
          numColumns={2}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.gridRow}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              {searchField}
              {search ? (
                <Text style={styles.searchResultCount}>
                  검색 결과 {found.length}개
                </Text>
              ) : (
                <>
                  {tags.length > 0 && (
                    <View style={styles.suggestions}>
                      <Text style={styles.suggestionsTitle}>저장된 태그</Text>
                      <View style={styles.tags}>
                        {tags.map((tag) => (
                          <Pressable
                            key={tag}
                            onPress={() => setQuery(tag)}
                            accessibilityRole="button"
                            accessibilityLabel={`${tag} 검색`}
                            style={({ pressed }) => [
                              styles.tag,
                              pressed && styles.pressed,
                            ]}
                          >
                            <Text style={styles.tagText}>#{tag}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}
                  <Text style={styles.searchHint}>
                    제목·태그·메모·링크에 포함된 단어를 검색합니다.
                  </Text>
                </>
              )}
            </View>
          }
          renderItem={({ item }) => <ClipCard item={item} onOpen={onOpen} />}
          ListEmptyComponent={
            search ? (
              <EmptyState
                title="검색 결과가 없어요"
                body="제목, 태그, 메모에 저장된 다른 단어로 검색하세요."
                action="검색어 지우기"
                onAction={() => {
                  setQuery("");
                  input.current?.focus();
                }}
              />
            ) : tags.length === 0 ? (
              <EmptyState
                title="저장한 항목을 찾아보세요"
                body="링크나 이미지를 추가하면 제목, 태그, 메모로 검색할 수 있어요."
                action="항목 추가"
                onAction={onAdd}
              />
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  gridContent: { paddingHorizontal: 22, paddingBottom: 24 },
  gridRow: { gap: 13 },
  card: { flex: 1, maxWidth: "48%", minWidth: 0, marginBottom: 25 },
  cardPress: { flex: 1 },
  cardImageWrap: {
    aspectRatio: 0.86,
    overflow: "hidden",
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  cardImage: { width: "100%", height: "100%" },
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  platformPill: {
    position: "absolute",
    left: 7,
    bottom: 7,
    maxWidth: "92%",
    borderRadius: 5,
    backgroundColor: "#101114ed",
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  platformText: { color: "#ffffff", fontSize: 10, fontWeight: "500" },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "500",
    letterSpacing: -0.3,
    marginTop: 11,
    lineHeight: 21,
  },
  cardMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 5,
    marginTop: 4,
  },
  cardMetaText: { color: colors.muted, fontSize: 11, flex: 1 },
  cardDate: {
    color: colors.muted,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  favorite: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  favoriteDisc: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#141619e0",
  },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.4 },
  filterScroll: { marginHorizontal: -22 },
  filters: { gap: 5, paddingHorizontal: 22, paddingBottom: 4 },
  filter: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 9,
    justifyContent: "center",
  },
  filterSelected: { backgroundColor: colors.raised },
  filterText: { fontSize: 13, color: colors.muted },
  filterTextSelected: { color: colors.text, fontWeight: "500" },
  collectionTools: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    marginBottom: 11,
  },
  resultCount: { color: colors.muted, fontSize: 12 },
  toolsRight: { flexDirection: "row", alignItems: "center", gap: 5 },
  favoriteFilter: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 9,
  },
  favoriteFilterActive: { backgroundColor: colors.raised },
  sortButton: {
    minHeight: 44,
    paddingLeft: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  sortLabel: { fontSize: 12, color: colors.muted },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    paddingVertical: 54,
    minHeight: 280,
    gap: 14,
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: "500",
    color: colors.text,
    textAlign: "center",
    marginTop: 3,
    letterSpacing: -0.5,
  },
  emptyBody: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 22,
    textAlign: "center",
  },
  emptyButton: {
    paddingHorizontal: 18,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  emptyButtonText: { color: colors.text, fontSize: 13, fontWeight: "500" },
  storageNotice: {
    backgroundColor: colors.raised,
    padding: 12,
    borderRadius: 9,
    marginBottom: 14,
  },
  storageNoticeText: { color: colors.danger, fontSize: 12, lineHeight: 19 },
  retryButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 2,
    marginBottom: -6,
  },
  retryText: { color: colors.accent, fontSize: 13, fontWeight: "500" },
  sortOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 55,
    paddingHorizontal: 15,
    borderRadius: 10,
    marginBottom: 4,
  },
  sortOptionSelected: { backgroundColor: colors.raised },
  sortOptionText: { color: colors.text, fontSize: 15 },
  inputLabel: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 10,
  },
  folderInput: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    backgroundColor: colors.bg,
    paddingHorizontal: 14,
    borderRadius: 10,
    fontSize: 16,
  },
  fieldError: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 20,
    marginTop: 10,
  },
  saveFolder: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.text,
    borderRadius: 11,
    marginTop: 24,
  },
  saveFolderText: { fontSize: 15, fontWeight: "600", color: colors.bg },
  folderToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  newFolderButton: {
    minHeight: 44,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingLeft: 12,
  },
  newFolderLabel: { color: colors.accent, fontSize: 13 },
  folderCard: { flex: 1, maxWidth: "48%", minWidth: 0, marginBottom: 29 },
  folderCover: {
    height: 155,
    flexDirection: "row",
    gap: 3,
    overflow: "hidden",
    borderRadius: 12,
    backgroundColor: colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  folderMainImage: { flex: 1.6, height: "100%" },
  folderSubImages: { flex: 1, height: "100%", gap: 3 },
  folderSubImage: { flex: 1, width: "100%" },
  folderName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "500",
    marginTop: 13,
    letterSpacing: -0.2,
  },
  folderCount: { color: colors.muted, fontSize: 12, marginTop: 7 },
  searchField: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#5e6674",
    paddingBottom: 8,
    marginBottom: 25,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    color: colors.text,
    paddingVertical: 10,
    minHeight: 44,
    letterSpacing: -0.4,
  },
  searchResultCount: { color: colors.muted, fontSize: 12, marginBottom: 20 },
  suggestions: { marginTop: 13, marginBottom: 30 },
  suggestionsTitle: { color: colors.muted, fontSize: 13, marginBottom: 16 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 9,
  },
  tagText: { color: colors.text, fontSize: 13 },
  searchHint: { color: colors.muted, fontSize: 12, lineHeight: 21 },
});
