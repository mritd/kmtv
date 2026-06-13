// Skeleton uses reanimated to loop a brightness change as the loading placeholder.
// Skeleton 使用 reanimated 循环亮度变化作为加载占位.

import React, { useEffect } from "react";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { sizes } from "./theme";
import { useTheme } from "./useTheme";

interface Props {
  width: number;
  height: number;
  radius?: number;
  testID?: string;
}

/**
 * Skeleton placeholder pulsing between 0.5 and 1.0 opacity in a 750 ms reverse-repeat loop.
 * 在 750 ms 反向循环中, 在 0.5 与 1.0 之间脉动的占位骨架.
 */
export function Skeleton({ width, height, radius = sizes.radius.md, testID }: Props) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 750, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      testID={testID}
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.bgCard },
        style,
      ]}
    />
  );
}
