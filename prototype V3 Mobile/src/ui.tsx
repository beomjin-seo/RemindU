import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  PressableProps,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  StyleProp,
} from "react-native";
import { ArrowLeft, Info, Plus, type LucideIcon } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { colors } from "./theme";

export function useMotionReduced() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduced(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
export const selectionHaptic = () => {
  void Haptics.selectionAsync().catch(() => {});
};

type ScaleProps = Omit<PressableProps, "style" | "children"> & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export function PressableScale({
  children,
  style,
  onPressIn,
  onPressOut,
  ...props
}: ScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduced = useMotionReduced();
  useEffect(() => {
    if (reduced) {
      scale.stopAnimation();
      scale.setValue(1);
    }
    return () => scale.stopAnimation();
  }, [reduced, scale]);
  const animate = (to: number) => {
    if (reduced) {
      scale.setValue(1);
      return;
    }
    Animated.spring(scale, {
      toValue: to,
      damping: 24,
      stiffness: 380,
      mass: 0.6,
      useNativeDriver: true,
    }).start();
  };
  // The padded visual surface is also the native hit target, not an outer wrapper.
  return (
    <AnimatedPressable
      {...props}
      style={[style, { transform: [{ scale }] }]}
      onPressIn={(e) => {
        animate(0.96);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        animate(1);
        onPressOut?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
export function IconButton({
  icon: Icon,
  onPress,
  label,
  filled = false,
  active = false,
  disabled = false,
}: {
  icon: LucideIcon;
  onPress: () => void;
  label: string;
  filled?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.iconButton,
        filled && styles.filled,
        active && styles.active,
        disabled && { opacity: 0.4 },
      ]}
    >
      <View style={styles.iconCenter}>
        <Icon
          size={21}
          strokeWidth={1.7}
          color={filled ? colors.bg : active ? colors.accent : colors.text}
        />
      </View>
    </PressableScale>
  );
}
export function Header({
  title,
  onAdd,
  onBack,
  onInfo,
  right,
}: {
  title: string;
  onAdd?: () => void;
  onBack?: () => void;
  onInfo?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.titleGroup}>
        {onBack && (
          <IconButton icon={ArrowLeft} onPress={onBack} label="이전 화면" />
        )}
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
      </View>
      <View style={styles.headerRight}>
        {right}
        {onInfo && <IconButton icon={Info} onPress={onInfo} label="앱 안내" />}
        {onAdd && (
          <IconButton icon={Plus} onPress={onAdd} label="항목 추가" filled />
        )}
      </View>
    </View>
  );
}
export function PrimaryButton({
  title,
  onPress,
  disabled,
  icon: Icon,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.primary, disabled && { opacity: 0.4 }]}
    >
      <View style={styles.primaryInner}>
        <Text style={styles.primaryText}>{title}</Text>
        {Icon && <Icon size={18} color={colors.bg} />}
      </View>
    </PressableScale>
  );
}
const styles = StyleSheet.create({
  header: {
    height: 82,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  titleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -1.1,
    flexShrink: 1,
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  iconCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
  },
  filled: { backgroundColor: colors.text, borderColor: colors.text },
  active: { backgroundColor: colors.raised, borderColor: colors.raised },
  primary: {
    backgroundColor: colors.text,
    minHeight: 52,
    borderRadius: 14,
    overflow: "hidden",
  },
  primaryInner: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 20,
  },
  primaryText: { fontSize: 15, fontWeight: "600", color: colors.bg },
});
