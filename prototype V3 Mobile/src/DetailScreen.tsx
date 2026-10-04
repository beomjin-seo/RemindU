import React, { useState } from "react";
import {
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { usePreventRemove } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ArrowUpRight,
  Bookmark,
  Copy,
  FolderClosed,
  Image as ImageIcon,
  Pencil,
  Trash2,
} from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { useLibrary } from "./storage";
import { imageSource } from "./assets";
import { safeURL } from "./model";
import { colors } from "./theme";
import {
  Header,
  IconButton,
  PrimaryButton,
  PressableScale,
  selectionHaptic,
} from "./ui";
import type { RootStackParamList } from "./navigation";

type Notice = (message: string, undo?: () => Promise<void>) => void;
type Props = NativeStackScreenProps<RootStackParamList, "Detail"> & {
  onEdit: (id: string) => void;
  notify: Notice;
};
const reason = (e: unknown) =>
  e instanceof Error ? e.message : "다시 시도해주세요.";

export default function DetailScreen({
  route,
  navigation,
  onEdit,
  notify,
}: Props) {
  const { items, folders, update, remove, restore } = useLibrary();
  const item = items.find((i) => i.id === route.params.id),
    insets = useSafeAreaInsets();
  const [note, setNote] = useState(item?.note || ""),
    [saving, setSaving] = useState(false),
    [deleting, setDeleting] = useState(false),
    [imageFailed, setImageFailed] = useState(false);
  const dirty = !!item && note !== item.note;
  usePreventRemove(dirty && !deleting, ({ data }) => {
    if (saving) return;
    Alert.alert("메모를 저장할까요?", "저장하지 않은 변경 사항이 있습니다.", [
      { text: "계속 편집", style: "cancel" },
      {
        text: "저장 안 함",
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
      {
        text: "저장 후 이동",
        onPress: () => {
          setSaving(true);
          void update(route.params.id, { note })
            .then(() => navigation.dispatch(data.action))
            .catch((e) => Alert.alert("저장 실패", reason(e)))
            .finally(() => setSaving(false));
        },
      },
    ]);
  });
  if (!item)
    return (
      <SafeAreaView style={s.screen}>
        <Header title="" onBack={() => navigation.goBack()} />
        <Text style={s.missing}>저장 항목을 찾을 수 없습니다.</Text>
      </SafeAreaView>
    );
  const source = imageSource(item),
    url = safeURL(item.url),
    folder = folders.find((f) => f.id === item.folderId);
  const saveNote = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await update(item.id, { note });
      notify("메모를 저장했습니다.");
    } catch (e) {
      Alert.alert("저장 실패", reason(e));
    } finally {
      setSaving(false);
    }
  };
  const favorite = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await update(item.id, { favorite: !item.favorite });
      selectionHaptic();
    } catch (e) {
      Alert.alert("변경 실패", reason(e));
    } finally {
      setSaving(false);
    }
  };
  const open = async () => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        "링크를 열 수 없습니다.",
        "주소를 복사해 브라우저에서 열어보세요.",
      );
    }
  };
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(url);
      notify("링크를 복사했습니다.");
      selectionHaptic();
    } catch {
      Alert.alert("복사 실패", "다시 시도해주세요.");
    }
  };
  const confirmDelete = () =>
    Alert.alert(
      "이 항목을 삭제할까요?",
      "삭제 후 잠시 동안 실행을 취소할 수 있습니다.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: () => {
            setDeleting(true);
            void remove(item.id)
              .then((removed) => {
                if (navigation.isFocused()) navigation.goBack();
                notify("항목을 삭제했습니다.", () => restore(removed));
              })
              .catch((e) => {
                setDeleting(false);
                Alert.alert("삭제 실패", reason(e));
              });
          },
        },
      ],
    );
  return (
    <SafeAreaView edges={["top"]} style={s.screen}>
      <Header
        title=""
        onBack={() => navigation.goBack()}
        right={
          <>
            <IconButton
              icon={Bookmark}
              label={item.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              active={item.favorite}
              disabled={saving}
              onPress={favorite}
            />
            <IconButton
              icon={Pencil}
              label="항목 편집"
              onPress={() => onEdit(item.id)}
            />
          </>
        }
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {source && !imageFailed ? (
            <Image
              source={source}
              style={s.hero}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
              accessibilityLabel={item.title}
            />
          ) : (
            <View style={[s.hero, s.placeholder]}>
              <ImageIcon color={colors.muted} size={48} strokeWidth={1} />
              <Text style={s.hint}>미리보기 이미지 없음</Text>
            </View>
          )}
          <View style={s.meta}>
            <Text style={s.platform}>{item.platform}</Text>
            {item.sample && <Text style={s.sample}>샘플</Text>}
            <Text style={s.date}>
              {new Date(item.savedAt).toLocaleDateString("ko-KR")}
            </Text>
          </View>
          <Text style={s.title}>{item.title}</Text>
          {url ? (
            <Text numberOfLines={2} style={s.domain}>
              {new URL(url).hostname}
              {item.sample ? " · 사진 출처 링크" : ""}
            </Text>
          ) : (
            <Text style={s.domain}>원본 링크 없음 · 원본 검색 연결 전</Text>
          )}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="폴더 및 키워드 편집"
            onPress={() => onEdit(item.id)}
            style={s.folder}
          >
            <View style={s.folderInner}>
              <FolderClosed color={colors.accent} size={17} />
              <Text style={s.folderText}>{folder?.name || "미분류"}</Text>
              <Pencil size={13} color={colors.muted} />
            </View>
          </PressableScale>
          {!!item.tags.length && (
            <View style={s.tags}>
              {item.tags.map((tag) => (
                <Text key={tag} style={s.tag}>
                  #{tag}
                </Text>
              ))}
            </View>
          )}
          <View style={s.divider} />
          <View style={s.noteHeading}>
            <Text style={s.sectionTitle}>메모</Text>
            {dirty && (
              <PressableScale
                accessibilityRole="button"
                disabled={saving}
                onPress={saveNote}
                style={s.saveNote}
              >
                <Text style={s.saveText}>
                  {saving ? "저장 중…" : "메모 저장"}
                </Text>
              </PressableScale>
            )}
          </View>
          <TextInput
            multiline
            accessibilityLabel="메모"
            value={note}
            onChangeText={setNote}
            editable={!saving && !deleting}
            style={s.note}
            placeholder="직접 메모를 남길 수 있습니다."
            placeholderTextColor={colors.muted}
            maxLength={4000}
            textAlignVertical="top"
          />
          <PressableScale
            accessibilityRole="button"
            onPress={confirmDelete}
            disabled={deleting || saving}
            style={s.delete}
          >
            <View style={s.deleteInner}>
              <Trash2 size={16} color={colors.danger} />
              <Text style={s.deleteText}>항목 삭제</Text>
            </View>
          </PressableScale>
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            title={
              url
                ? item.sample
                  ? "사진 출처 열기"
                  : "원본 열기"
                : "원본 링크 없음"
            }
            icon={ArrowUpRight}
            disabled={!url}
            onPress={open}
          />
        </View>
        {!!url && <IconButton icon={Copy} onPress={copy} label="링크 복사" />}
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 22, paddingBottom: 24 },
  hero: {
    width: "100%",
    height: 300,
    borderRadius: 23,
    backgroundColor: colors.surface,
  },
  placeholder: { alignItems: "center", justifyContent: "center", gap: 14 },
  hint: { color: colors.muted, fontSize: 13 },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 24,
    marginBottom: 12,
  },
  platform: { fontSize: 12, fontWeight: "600", color: colors.accent },
  sample: {
    fontSize: 10,
    color: colors.muted,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  date: { marginLeft: "auto", color: colors.muted, fontSize: 11 },
  title: {
    fontSize: 29,
    fontWeight: "600",
    letterSpacing: -0.9,
    lineHeight: 39,
    color: colors.text,
  },
  domain: { fontSize: 13, color: colors.muted, lineHeight: 20, marginTop: 7 },
  folder: {
    alignSelf: "flex-start",
    borderRadius: 12,
    backgroundColor: colors.surface,
    marginTop: 22,
  },
  folderInner: {
    minHeight: 44,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  folderText: { fontSize: 13, color: colors.text },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 18 },
  tag: { color: colors.muted, fontSize: 13 },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginTop: 26,
    marginBottom: 10,
  },
  noteHeading: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "500" },
  saveNote: { minHeight: 44, justifyContent: "center" },
  saveText: { color: colors.accent, fontSize: 13, paddingVertical: 12 },
  note: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 24,
    minHeight: 92,
    paddingVertical: 10,
  },
  delete: { alignSelf: "flex-start", marginTop: 20 },
  deleteInner: {
    minHeight: 44,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  deleteText: { fontSize: 13, color: colors.danger },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingTop: 14,
    paddingHorizontal: 22,
    borderTopWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  missing: { color: colors.muted, textAlign: "center", marginTop: 60 },
});
