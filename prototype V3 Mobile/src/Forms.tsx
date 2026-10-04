import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Image,
  Alert,
  Share,
} from "react-native";
import {
  Link2,
  ImagePlus,
  ArrowUpRight,
  Check,
  HardDrive,
  Download,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { colors } from "./theme";
import { useLibrary } from "./storage";
import { safeURL } from "./model";
import { PressableScale, PrimaryButton, selectionHaptic } from "./ui";
import Sheet from "./Sheet";

export function AddSheet({
  folderId = "inbox",
  onClose,
  onSaved,
}: {
  folderId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { folders, add } = useLibrary();
  const [mode, setMode] = useState<"link" | "image">("link"),
    [url, setUrl] = useState(""),
    [title, setTitle] = useState(""),
    [folder, setFolder] = useState(folderId),
    [image, setImage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [closing, setClosing] = useState(false);
  const pick = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        base64: true,
        quality: 0.65,
        allowsMultipleSelection: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset.base64)
        throw Error("이미지를 읽지 못했습니다. 다시 선택해주세요.");
      if (asset.base64.length > 1200000)
        throw Error("이 시안에서는 약 800 KB 이하의 이미지를 선택해주세요.");
      setImage(`data:image/jpeg;base64,${asset.base64}`);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진을 선택하지 못했습니다.");
    }
  };
  const save = async () => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (mode === "link" && !safeURL(url))
        throw Error("http 또는 https로 시작하는 주소를 입력해주세요.");
      if (mode === "image" && !image)
        throw Error("저장할 이미지를 선택해주세요.");
      await add({
        title:
          title.trim() ||
          (mode === "image" ? "스크린샷" : new URL(url).hostname),
        url: mode === "link" ? url : "",
        imageUri: mode === "image" ? image : undefined,
        folderId: folder,
      });
      selectionHaptic();
      onSaved();
      setClosing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="항목 추가"
      onClose={onClose}
      busy={busy}
      closeRequested={closing}
    >
      <View style={s.modes}>
        {(["link", "image"] as const).map((m) => (
          <PressableScale
            key={m}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === m }}
            onPress={() => {
              setMode(m);
              setError("");
            }}
            style={[s.mode, mode === m && s.selected]}
          >
            <View style={s.inline}>
              {m === "link" ? (
                <Link2 color={colors.text} size={18} />
              ) : (
                <ImagePlus color={colors.text} size={18} />
              )}
              <Text style={s.text}>{m === "link" ? "링크" : "이미지"}</Text>
            </View>
          </PressableScale>
        ))}
      </View>
      {mode === "link" ? (
        <>
          <Text style={s.label}>URL</Text>
          <TextInput
            accessibilityLabel="저장할 URL"
            style={s.input}
            placeholder="https://"
            placeholderTextColor={colors.muted}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!busy}
          />
          <PressableScale
            accessibilityRole="button"
            onPress={async () => {
              try {
                setUrl(await Clipboard.getStringAsync());
              } catch {
                setError(
                  "클립보드를 읽지 못했습니다. 주소를 직접 입력해주세요.",
                );
              }
            }}
            disabled={busy}
            style={s.paste}
          >
            <Text style={s.linkText}>클립보드에서 붙여넣기</Text>
          </PressableScale>
        </>
      ) : (
        <PressableScale
          disabled={busy}
          onPress={pick}
          accessibilityRole="button"
          accessibilityLabel="이미지 선택"
          style={s.upload}
        >
          {image ? (
            <Image source={{ uri: image }} style={s.preview} />
          ) : (
            <View style={s.uploadInner}>
              <ImagePlus color={colors.accent} size={30} />
              <Text style={s.text}>사진에서 선택</Text>
              <Text style={s.hint}>
                이미지 약 800 KB · 전체 저장 데이터 1.5 MB 제한
              </Text>
            </View>
          )}
        </PressableScale>
      )}
      <Text style={s.label}>
        제목 <Text style={s.hint}>선택 사항</Text>
      </Text>
      <TextInput
        accessibilityLabel="제목"
        style={s.input}
        placeholder="내용을 알아볼 수 있는 제목"
        placeholderTextColor={colors.muted}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
        editable={!busy}
      />
      <Text style={s.label}>저장할 폴더</Text>
      <View style={s.folderOptions}>
        {folders.map((f) => (
          <PressableScale
            disabled={busy}
            key={f.id}
            onPress={() => setFolder(f.id)}
            style={[s.folder, folder === f.id && s.selected]}
            accessibilityRole="radio"
            accessibilityState={{ checked: folder === f.id }}
            accessibilityLabel={f.name}
          >
            <View style={s.inline}>
              <Text style={s.text}>{f.name}</Text>
              {folder === f.id && <Check size={15} color={colors.accent} />}
            </View>
          </PressableScale>
        ))}
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <PrimaryButton
        title={busy ? "저장 중…" : "저장하기"}
        onPress={save}
        disabled={busy}
        icon={ArrowUpRight}
      />
      <View style={s.note}>
        <HardDrive size={16} color={colors.muted} />
        <Text style={s.hint}>
          이 기기에 저장됩니다. AI 자동 분류·원본 검색은 연결 전입니다.
        </Text>
      </View>
    </Sheet>
  );
}
export function EditSheet({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { items, folders, update } = useLibrary();
  const item = items.find((i) => i.id === id);
  const [title, setTitle] = useState(item?.title || ""),
    [tags, setTags] = useState(item?.tags.join(", ") || ""),
    [folder, setFolder] = useState(item?.folderId || "inbox"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [closing, setClosing] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await update(id, {
        title,
        folderId: folder,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onSaved();
      setClosing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="항목 편집"
      onClose={onClose}
      busy={busy}
      closeRequested={closing}
    >
      <Text style={s.label}>제목</Text>
      <TextInput
        accessibilityLabel="제목"
        style={s.input}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
        editable={!busy}
      />
      <Text style={s.label}>키워드</Text>
      <TextInput
        accessibilityLabel="키워드"
        style={s.input}
        value={tags}
        onChangeText={setTags}
        placeholder="쉼표로 구분"
        placeholderTextColor={colors.muted}
        editable={!busy}
      />
      <Text style={s.label}>폴더</Text>
      <View style={s.folderOptions}>
        {folders.map((f) => (
          <PressableScale
            key={f.id}
            disabled={busy}
            onPress={() => setFolder(f.id)}
            style={[s.folder, folder === f.id && s.selected]}
            accessibilityLabel={f.name}
            accessibilityRole="radio"
            accessibilityState={{ checked: folder === f.id }}
          >
            <View style={s.inline}>
              <Text style={s.text}>{f.name}</Text>
              {folder === f.id && <Check size={15} color={colors.accent} />}
            </View>
          </PressableScale>
        ))}
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <PrimaryButton
        title={busy ? "저장 중…" : "변경 저장"}
        onPress={save}
        disabled={busy || !title.trim()}
      />
    </Sheet>
  );
}
export function HelpSheet({ onClose }: { onClose: () => void }) {
  const { items, folders } = useLibrary();
  const exportData = async () => {
    try {
      await Share.share({
        title: "Storyge 저장 데이터",
        message: JSON.stringify({ version: 1, items, folders }, null, 2),
      });
    } catch {
      Alert.alert("내보내기 실패", "다시 시도해주세요.");
    }
  };
  return (
    <Sheet title="Storyge V3" onClose={onClose}>
      <Text style={s.aboutTitle}>모바일 앱 시안</Text>
      <Text style={s.about}>
        iOS·Android용 React Native 앱입니다. 링크·이미지, 폴더, 즐겨찾기, 메모는
        이 기기에 저장됩니다.
      </Text>
      <View style={s.rule} />
      <Text style={s.label}>아직 연결되지 않은 기능</Text>
      <Text style={s.about}>
        AI 자동 분류 · 스크린샷 원본 검색 · 의미 검색{"\n"}OS 공유 확장 · 계정 ·
        기기 간 동기화
      </Text>
      <Text style={s.about}>
        샘플 9개의 링크는 사진 출처입니다. 앱을 삭제하면 기기 내 데이터도 사라질
        수 있습니다. 저장 데이터는 암호화되지 않으며, 민감한 정보는 넣지 마세요.
      </Text>
      <PrimaryButton
        title="저장 데이터 공유"
        icon={Download}
        onPress={exportData}
      />
      <Text style={[s.hint, { marginTop: 14 }]}>
        JSON 텍스트로 공유합니다. 이미지 데이터·메모·URL이 포함되므로 공유
        대상을 확인하세요. 가져오기 기능은 아직 없습니다.
      </Text>
    </Sheet>
  );
}
const s = StyleSheet.create({
  modes: { flexDirection: "row", gap: 8, marginBottom: 22 },
  mode: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  selected: { backgroundColor: colors.raised, borderColor: colors.accent },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: { fontSize: 14, color: colors.text },
  label: { color: colors.muted, fontSize: 13, marginBottom: 10, marginTop: 8 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 16,
    marginBottom: 16,
  },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 18, flexShrink: 1 },
  paste: {
    alignSelf: "flex-end",
    minHeight: 44,
    padding: 10,
    marginTop: -10,
    marginBottom: 8,
  },
  linkText: { fontSize: 13, color: colors.accent },
  folderOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 24,
  },
  folder: {
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    minHeight: 44,
  },
  note: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 18,
    marginTop: 18,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  error: {
    color: colors.danger,
    lineHeight: 20,
    fontSize: 13,
    marginBottom: 15,
  },
  upload: {
    height: 150,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line,
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 18,
  },
  uploadInner: {
    height: 150,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  preview: { height: 150, width: "100%", resizeMode: "cover" },
  aboutTitle: {
    fontSize: 26,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 12,
  },
  about: {
    fontSize: 14,
    lineHeight: 23,
    color: colors.muted,
    marginBottom: 20,
  },
  rule: { height: 1, backgroundColor: colors.line, marginBottom: 16 },
});
