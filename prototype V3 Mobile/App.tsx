import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  StyleSheet,
  Text,
  View,
  Pressable,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  NavigationContainer,
  DarkTheme,
  useIsFocused,
  useNavigation,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import {
  Orbit,
  Layers2,
  FolderClosed,
  Search,
  Check,
  Undo2,
} from "lucide-react-native";
import { LibraryProvider, useLibrary } from "./src/storage";
import OrbitFeed from "./src/OrbitFeed";
import {
  LibraryScreen,
  FoldersScreen,
  FolderScreen,
  SearchScreen,
} from "./src/CollectionScreens";
import DetailScreen from "./src/DetailScreen";
import { AddSheet, EditSheet, HelpSheet } from "./src/Forms";
import {
  Header,
  PrimaryButton,
  useMotionReduced,
  selectionHaptic,
} from "./src/ui";
import { colors } from "./src/theme";
import type { RootStackParamList, TabParamList } from "./src/navigation";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
type SheetState =
  | { type: "add"; folderId?: string }
  | { type: "edit"; id: string }
  | { type: "help" }
  | null;
type Actions = {
  openAdd: (folderId?: string) => void;
  openHelp: () => void;
  sheetOpen: boolean;
};
const ActionsContext = createContext<Actions>({
  openAdd: () => {},
  openHelp: () => {},
  sheetOpen: false,
});
const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.line,
    notification: colors.accent,
  },
};

function Feed() {
  const { items, error, retry } = useLibrary(),
    { openAdd, sheetOpen } = useContext(ActionsContext),
    focused = useIsFocused();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <SafeAreaView edges={["top"]} style={s.screen}>
      <Header title="나의 피드" onAdd={() => openAdd()} />
      {error && (
        <View>
          <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={{
              minHeight: 44,
              paddingHorizontal: 22,
              justifyContent: "center",
            }}
            onPress={() => {
              void retry().catch((e) =>
                Alert.alert("불러오기 실패", e.message),
              );
            }}
          >
            <Text style={{ color: colors.accent }}>다시 불러오기</Text>
          </Pressable>
        </View>
      )}
      {items.length ? (
        <OrbitFeed
          items={items}
          onOpen={(id) => navigation.navigate("Detail", { id })}
          active={focused && !sheetOpen}
        />
      ) : (
        <View style={s.empty}>
          <Orbit color={colors.muted} size={46} strokeWidth={1} />
          <Text style={s.emptyTitle}>저장 항목이 없습니다.</Text>
          <View style={{ width: 180 }}>
            <PrimaryButton title="첫 항목 추가" onPress={() => openAdd()} />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
function Tabs() {
  const insets = useSafeAreaInsets(),
    { openAdd, openHelp } = useContext(ActionsContext);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const onOpen = (id: string) => navigation.navigate("Detail", { id });
  return (
    <Tab.Navigator
      initialRouteName="Feed"
      screenListeners={{ tabPress: () => selectionHaptic() }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: "#7f8590",
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: "#272a30",
          height: 64 + insets.bottom,
          paddingTop: 9,
          paddingBottom: Math.max(insets.bottom, 10),
          elevation: 0,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500", marginTop: 3 },
        tabBarIcon: ({ color, focused }) => {
          const Icon = {
            Feed: Orbit,
            Library: Layers2,
            Folders: FolderClosed,
            Search,
          }[route.name];
          return (
            <View style={s.tabIcon}>
              <Icon size={22} color={color} strokeWidth={focused ? 1.9 : 1.5} />
              {focused && <View style={s.tabDot} />}
            </View>
          );
        },
      })}
    >
      <Tab.Screen
        name="Feed"
        component={Feed}
        options={{ title: "나의 피드" }}
      />
      <Tab.Screen name="Library" options={{ title: "보관함" }}>
        {() => (
          <LibraryScreen
            onOpen={onOpen}
            onAdd={() => openAdd()}
            onInfo={openHelp}
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Folders" options={{ title: "폴더" }}>
        {() => (
          <FoldersScreen
            onFolder={(folderId) => navigation.navigate("Folder", { folderId })}
            onAdd={() => openAdd()}
            onInfo={openHelp}
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Search" options={{ title: "검색" }}>
        {() => (
          <SearchScreen
            onOpen={onOpen}
            onAdd={() => openAdd()}
            onInfo={openHelp}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}
type Toast = { id: number; message: string; undo?: () => Promise<void> };
function ToastView({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets(),
    reduced = useMotionReduced(),
    y = useRef(new Animated.Value(20)).current;
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Animated.spring(y, {
      toValue: 0,
      damping: 25,
      stiffness: 280,
      useNativeDriver: true,
    }).start();
    const t = setTimeout(onDismiss, toast.undo ? 9000 : 3000);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss, y, toast.undo]);
  const undo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await toast.undo?.();
      onDismiss();
    } catch (e) {
      Alert.alert(
        "복원 실패",
        e instanceof Error ? e.message : "다시 시도해주세요.",
      );
      setBusy(false);
    }
  };
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[
        s.toast,
        {
          bottom: Math.max(insets.bottom, 12) + 72,
          transform: [{ translateY: reduced ? 0 : y }],
        },
      ]}
    >
      <Check size={17} color={colors.accent} />
      <Text style={s.toastText}>{toast.message}</Text>
      {toast.undo && (
        <Pressable
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="삭제 실행 취소"
          onPress={undo}
          style={s.undo}
        >
          <Undo2 color={colors.accent} size={15} />
          <Text style={s.undoText}>{busy ? "복원 중" : "실행 취소"}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}
function Shell() {
  const { ready } = useLibrary(),
    reduced = useMotionReduced();
  const [intro, setIntro] = useState(true),
    [loaded, setLoaded] = useState(false),
    [sheet, setSheet] = useState<SheetState>(null),
    [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 650);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (ready) setLoaded(true);
  }, [ready]);
  const dismissToast = useCallback(() => setToast(null), []);
  const notify = (message: string, undo?: () => Promise<void>) =>
    setToast({ id: Date.now(), message, undo });
  if (!loaded || intro)
    return (
      <View style={s.splash}>
        <Text accessibilityRole="header" style={s.wordmark}>
          Storyge<Text style={{ color: colors.accent }}>.</Text>
        </Text>
      </View>
    );
  return (
    <ActionsContext.Provider
      value={{
        openAdd: (folderId) => setSheet({ type: "add", folderId }),
        openHelp: () => setSheet({ type: "help" }),
        sheetOpen: !!sheet,
      }}
    >
      <NavigationContainer theme={theme}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: reduced ? "none" : "slide_from_right",
            animationDuration: 400,
            gestureEnabled: true,
          }}
        >
          <Stack.Screen name="Tabs" component={Tabs} />
          <Stack.Screen name="Detail">
            {(props) => (
              <DetailScreen
                {...props}
                onEdit={(id) => setSheet({ type: "edit", id })}
                notify={notify}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Folder">
            {({ route, navigation }) => (
              <FolderScreen
                folderId={route.params.folderId}
                onBack={() => navigation.goBack()}
                onOpen={(id) => navigation.navigate("Detail", { id })}
                onAdd={() =>
                  setSheet({ type: "add", folderId: route.params.folderId })
                }
              />
            )}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
      {toast && (
        <ToastView key={toast.id} toast={toast} onDismiss={dismissToast} />
      )}
      {sheet?.type === "add" && (
        <AddSheet
          folderId={sheet.folderId}
          onClose={() => setSheet(null)}
          onSaved={() => notify("항목을 저장했습니다.")}
        />
      )}
      {sheet?.type === "edit" && (
        <EditSheet
          id={sheet.id}
          onClose={() => setSheet(null)}
          onSaved={() => notify("변경 사항을 저장했습니다.")}
        />
      )}
      {sheet?.type === "help" && <HelpSheet onClose={() => setSheet(null)} />}
    </ActionsContext.Provider>
  );
}
export default function App() {
  return (
    <GestureHandlerRootView style={s.screen}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <LibraryProvider>
          <Shell />
        </LibraryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  splash: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  wordmark: {
    fontSize: 44,
    color: colors.text,
    fontWeight: "600",
    letterSpacing: -2.2,
  },
  tabIcon: { height: 28, alignItems: "center", justifyContent: "center" },
  tabDot: {
    position: "absolute",
    bottom: -6,
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    paddingBottom: 50,
  },
  emptyTitle: { color: colors.muted, fontSize: 16 },
  error: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 22,
  },
  toast: {
    position: "absolute",
    left: 18,
    right: 18,
    borderRadius: 16,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: "#3c414b",
    minHeight: 54,
    paddingHorizontal: 15,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  toastText: { color: colors.text, fontSize: 13, flex: 1, lineHeight: 18 },
  undo: { minHeight: 44, flexDirection: "row", gap: 5, alignItems: "center" },
  undoText: { color: colors.accent, fontSize: 12, fontWeight: "600" },
});
