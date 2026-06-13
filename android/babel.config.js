module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // react-native-reanimated/plugin must be the LAST plugin in the array.
    // react-native-reanimated/plugin 必须是 plugins 数组的最后一项.
    plugins: ["react-native-reanimated/plugin"],
  };
};
