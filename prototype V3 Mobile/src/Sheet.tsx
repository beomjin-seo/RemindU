import React, { useEffect, useCallback } from "react";
import {
  Modal,
  View,
  Pressable,
  Text,
  StyleSheet,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  ScrollView,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { IconButton, useMotionReduced } from "./ui";
import { colors } from "./theme";

export default function Sheet({
  title,
  onClose,
  busy = false,
  closeRequested = false,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  closeRequested?: boolean;
  children: React.ReactNode;
}) {
  const { height } = useWindowDimensions(),
    insets = useSafeAreaInsets(),
    reduced = useMotionReduced();
  const y = useSharedValue(height),
    closing = useSharedValue(false),
    startY = useSharedValue(0);
  useEffect(() => {
    if (!closing.value)
      y.value = withTiming(0, {
        duration: reduced ? 0 : 380,
        easing: Easing.bezier(0.32, 0.72, 0, 1),
      });
  }, [reduced, y, closing]);
  useEffect(
    () => () => {
      cancelAnimation(y);
    },
    [y],
  );
  const close = useCallback(() => {
    if (busy || closing.value) return;
    closing.value = true;
    Keyboard.dismiss();
    y.value = withTiming(
      height,
      { duration: reduced ? 0 : 280, easing: Easing.bezier(0.32, 0.72, 0, 1) },
      (done) => {
        if (done) scheduleOnRN(onClose);
      },
    );
  }, [busy, closing, height, onClose, reduced, y]);
  useEffect(() => {
    if (closeRequested && !busy) close();
  }, [closeRequested, busy, close]);
  const pan = Gesture.Pan()
    .enabled(!busy && !closeRequested)
    .minDistance(6)
    .maxPointers(1)
    .onBegin(() => {
      // Catch the live presentation position, including an interrupted exit.
      cancelAnimation(y);
      closing.value = false;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      y.value = Math.max(0, startY.value + e.translationY);
    })
    .onEnd((e) => {
      if (y.value > 100 || e.velocityY > 850) scheduleOnRN(close);
      else
        y.value = reduced
          ? 0
          : withSpring(0, {
              damping: 28,
              stiffness: 300,
              velocity: e.velocityY,
            });
    })
    .onFinalize((_e, success) => {
      if (!success && !closing.value)
        y.value = reduced ? 0 : withSpring(0, { damping: 28, stiffness: 300 });
    });
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={close}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            accessible={false}
            importantForAccessibility="no"
            disabled={busy}
            style={styles.scrim}
            onPress={close}
          />
          <Animated.View
            accessibilityViewIsModal
            onAccessibilityEscape={close}
            style={[
              styles.panel,
              {
                maxHeight: height - insets.top - 16,
                paddingBottom: Math.max(insets.bottom, 18),
              },
              animated,
            ]}
          >
            <GestureDetector gesture={pan}>
              <View style={styles.handleArea}>
                <View style={styles.handle} />
              </View>
            </GestureDetector>
            <View style={styles.header}>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              <IconButton
                icon={X}
                label="닫기"
                onPress={close}
                disabled={busy}
              />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              bounces={false}
              contentContainerStyle={styles.body}
            >
              {children}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,.55)" },
  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  handleArea: { height: 44, alignItems: "center", justifyContent: "center" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#666d79" },
  header: {
    paddingHorizontal: 22,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 23,
    fontWeight: "600",
    letterSpacing: -0.6,
    color: colors.text,
  },
  body: { paddingHorizontal: 22, paddingBottom: 14 },
});
