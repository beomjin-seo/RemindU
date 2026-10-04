import React, { memo, useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { FileText, Scan } from "lucide-react-native";
import type { Clip } from "./model";
import { imageSource } from "./assets";
import { colors } from "./theme";

type Props = { items: Clip[]; onOpen: (id: string) => void; active?: boolean };
type Point = { x: number; y: number };
type Field = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  focusX: SharedValue<number>;
  focusY: SharedValue<number>;
  focus: SharedValue<number>;
};

const SETTLE = { damping: 28, stiffness: 240, mass: 0.85 };

function clamp(value: number, min: number, max: number) {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

function resist(value: number, limit: number, dimension: number) {
  "worklet";
  if (Math.abs(value) <= limit) return value;
  const excess = Math.abs(value) - limit;
  return (
    Math.sign(value) *
    (limit + (excess * dimension * 0.45) / (dimension + excess * 0.45))
  );
}

/** A tall honeycomb: the first nine clips form a 1–2–3–2–1 arrangement. */
function arrange(count: number, step: number): Point[] {
  const first: [number, number][] = [
    [0, 0],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, -2],
    [-1, 2],
  ];
  const cells = first.slice(0, count);
  const used = new Set(first.map(([q, r]) => `${q}:${r}`));
  for (let ring = 2; cells.length < count; ring++) {
    const outer: [number, number][] = [];
    for (let q = -ring; q <= ring; q++) {
      for (let r = -ring; r <= ring; r++) {
        if (
          Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) !== ring ||
          used.has(`${q}:${r}`)
        )
          continue;
        outer.push([q, r]);
      }
    }
    outer.sort(
      ([aq, ar], [bq, br]) =>
        (aq + ar / 2) ** 2 +
        (ar * 0.6) ** 2 -
        ((bq + br / 2) ** 2 + (br * 0.6) ** 2),
    );
    for (const cell of outer) {
      if (cells.length >= count) break;
      cells.push(cell);
    }
  }
  return cells.map(([q, r]) => ({
    x: (q + r / 2) * step,
    y: r * step * 0.8660254,
  }));
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduce(value);
      })
      .catch(() => {});
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduce,
    );
    return () => {
      mounted = false;
      listener.remove();
    };
  }, []);
  return reduce;
}

type BubbleProps = {
  item: Clip;
  point: Point;
  diameter: number;
  width: number;
  height: number;
  field: Field;
  reduced: boolean;
  onOpen: Props["onOpen"];
};

const Bubble = memo(function Bubble({
  item,
  point,
  diameter,
  width,
  height,
  field,
  reduced,
  onOpen,
}: BubbleProps) {
  const [failedImage, setFailedImage] = useState(false);
  const source = imageSource(item);
  const animated = useAnimatedStyle(() => {
    const x = point.x + field.x.value;
    const y = point.y + field.y.value;
    const touchWeight = reduced ? 0 : field.focus.value;
    const focusX = (field.focusX.value - width / 2) * touchWeight;
    const focusY = (field.focusY.value - height / 2) * touchWeight;
    const dx = x - focusX;
    const dy = y - focusY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const near = clamp(1 - distance / (diameter * 2), 0, 1);
    const scale = reduced ? 1 : 0.83 + near * (0.2 + touchWeight * 0.11);
    const push = touchWeight * near * 8;
    return {
      transform: [
        { translateX: x + (distance > 1 ? (dx / distance) * push : 0) },
        { translateY: y + (distance > 1 ? (dy / distance) * push : 0) },
        { scale },
      ],
      zIndex: Math.round(near * 20),
    };
  });
  useEffect(() => setFailedImage(false), [item.imageKey, item.imageUri]);
  return (
    <Animated.View
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.platform}${item.sample ? ", 샘플" : ""}`}
      accessibilityHint="저장한 항목의 상세 화면을 엽니다"
      accessibilityActions={[{ name: "activate", label: "항목 열기" }]}
      onAccessibilityTap={() => onOpen(item.id)}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "activate") onOpen(item.id);
      }}
      style={[
        styles.bubble,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          left: (width - diameter) / 2,
          top: (height - diameter) / 2,
        },
        animated,
      ]}
    >
      {source && !failedImage ? (
        <Image
          source={source}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
          onError={() => setFailedImage(true)}
          accessible={false}
        />
      ) : (
        <View style={styles.placeholder}>
          <FileText size={28} strokeWidth={1.4} color={colors.accent} />
          <Text numberOfLines={2} style={styles.placeholderTitle}>
            {item.title}
          </Text>
        </View>
      )}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.rim,
          { borderRadius: diameter / 2 },
        ]}
      />
    </Animated.View>
  );
});

export default function OrbitFeed({ items, onOpen, active = true }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const reduced = useReduceMotion();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const focusX = useSharedValue(0);
  const focusY = useSharedValue(0);
  const focus = useSharedValue(0);
  const dragging = useSharedValue(false);
  const { width, height } = size;
  const diameter = Math.min(
    146,
    Math.max(78, width * 0.34),
    Math.max(78, (height - 16) / (items.length >= 8 ? 4.7 : 2.9)),
  );
  const step = diameter * 1.07;
  const points = useMemo(
    () => arrange(items.length, step),
    [items.length, step],
  );
  const extentX =
    points.reduce((max, point) => Math.max(max, Math.abs(point.x)), 0) +
    diameter / 2;
  const extentY =
    points.reduce((max, point) => Math.max(max, Math.abs(point.y)), 0) +
    diameter / 2;
  // Even a small collection can be moved a little; larger collections remain fully reachable.
  const limitX = Math.max(36, extentX - width / 2 + 44);
  const limitY = Math.max(42, extentY - height / 2 + 44);
  const field = useMemo(
    () => ({ x, y, focusX, focusY, focus }),
    [x, y, focusX, focusY, focus],
  );
  const hitPoints = useMemo(
    () => points.map((point, index) => ({ ...point, id: items[index].id })),
    [points, items],
  );

  useEffect(() => {
    if (!active) {
      cancelAnimation(x);
      cancelAnimation(y);
      cancelAnimation(focus);
      focus.value = 0;
    }
  }, [active, x, y, focus]);
  useEffect(() => {
    x.value = clamp(x.value, -limitX, limitX);
    y.value = clamp(y.value, -limitY, limitY);
  }, [limitX, limitY, x, y]);
  useEffect(() => {
    if (reduced) {
      cancelAnimation(x);
      cancelAnimation(y);
      cancelAnimation(focus);
      x.value = clamp(x.value, -limitX, limitX);
      y.value = clamp(y.value, -limitY, limitY);
      focus.value = 0;
    }
  }, [reduced, x, y, focus, limitX, limitY]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        cancelAnimation(x);
        cancelAnimation(y);
        cancelAnimation(focus);
        focus.value = 0;
      }
    });
    return () => {
      listener.remove();
      cancelAnimation(x);
      cancelAnimation(y);
      cancelAnimation(focus);
    };
  }, [x, y, focus]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(active)
      .minDistance(8)
      .maxPointers(1)
      .onBegin((event) => {
        cancelAnimation(x);
        cancelAnimation(y);
        focusX.value = event.x;
        focusY.value = event.y;
        focus.value = reduced ? 0 : withTiming(1, { duration: 110 });
      })
      .onStart(() => {
        dragging.value = true;
        startX.value = x.value;
        startY.value = y.value;
      })
      .onUpdate((event) => {
        x.value = resist(startX.value + event.translationX, limitX, width);
        y.value = resist(startY.value + event.translationY, limitY, height);
        focusX.value = event.x;
        focusY.value = event.y;
      })
      .onEnd((event) => {
        if (reduced) {
          x.value = clamp(x.value, -limitX, limitX);
          y.value = clamp(y.value, -limitY, limitY);
        } else {
          x.value =
            Math.abs(x.value) > limitX
              ? withSpring(clamp(x.value, -limitX, limitX), {
                  ...SETTLE,
                  velocity: event.velocityX,
                })
              : withDecay({
                  velocity: event.velocityX,
                  deceleration: 0.995,
                  clamp: [-limitX, limitX],
                  rubberBandEffect: true,
                  rubberBandFactor: 0.35,
                });
          y.value =
            Math.abs(y.value) > limitY
              ? withSpring(clamp(y.value, -limitY, limitY), {
                  ...SETTLE,
                  velocity: event.velocityY,
                })
              : withDecay({
                  velocity: event.velocityY,
                  deceleration: 0.995,
                  clamp: [-limitY, limitY],
                  rubberBandEffect: true,
                  rubberBandFactor: 0.35,
                });
        }
      })
      .onFinalize(() => {
        dragging.value = false;
        focus.value = reduced ? 0 : withTiming(0, { duration: 240 });
      });
    const tap = Gesture.Tap()
      .enabled(active)
      .maxDistance(8)
      .maxDuration(350)
      .onBegin((event) => {
        focusX.value = event.x;
        focusY.value = event.y;
        focus.value = reduced ? 0 : withTiming(1, { duration: 110 });
      })
      .onEnd((event, success) => {
        if (!success) return;
        let nearest = -1;
        let shortest = diameter * 0.57;
        for (let index = 0; index < hitPoints.length; index++) {
          const dx = event.x - (width / 2 + hitPoints[index].x + x.value);
          const dy = event.y - (height / 2 + hitPoints[index].y + y.value);
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < shortest) {
            shortest = distance;
            nearest = index;
          }
        }
        if (nearest !== -1) scheduleOnRN(onOpen, hitPoints[nearest].id);
      })
      .onFinalize(() => {
        if (!dragging.value)
          focus.value = reduced ? 0 : withTiming(0, { duration: 240 });
      });
    return Gesture.Race(pan, tap);
  }, [
    active,
    reduced,
    x,
    y,
    startX,
    startY,
    focus,
    focusX,
    focusY,
    dragging,
    limitX,
    limitY,
    width,
    height,
    diameter,
    hitPoints,
    onOpen,
  ]);

  function recenter() {
    x.value = reduced ? 0 : withSpring(0, SETTLE);
    y.value = reduced ? 0 : withSpring(0, SETTLE);
    focus.value = 0;
    AccessibilityInfo.announceForAccessibility(
      "피드를 처음 위치로 이동했습니다",
    );
  }

  return (
    <View
      style={styles.container}
      onLayout={(event) => {
        const { width: nextWidth, height: nextHeight } =
          event.nativeEvent.layout;
        if (nextWidth !== width || nextHeight !== height)
          setSize({ width: nextWidth, height: nextHeight });
      }}
    >
      {width > 0 && height > 0 && (
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            {items.map((item, index) => (
              <Bubble
                key={item.id}
                item={item}
                point={points[index]}
                diameter={diameter}
                width={width}
                height={height}
                field={field}
                reduced={reduced}
                onOpen={onOpen}
              />
            ))}
          </View>
        </GestureDetector>
      )}
      {!!items.length && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="피드 위치 초기화"
          accessibilityHint="원형 피드를 처음 위치로 되돌립니다"
          onPress={recenter}
          disabled={!active}
          style={({ pressed }) => [
            styles.reset,
            pressed && styles.resetPressed,
          ]}
        >
          <Scan size={21} strokeWidth={1.6} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: colors.bg,
    minHeight: 200,
  },
  bubble: {
    position: "absolute",
    overflow: "hidden",
    backgroundColor: colors.raised,
  },
  rim: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.15)",
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    gap: 8,
  },
  placeholderTitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  reset: {
    position: "absolute",
    right: 20,
    bottom: 16,
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  resetPressed: {
    backgroundColor: colors.raised,
    transform: [{ scale: 0.95 }],
  },
});
