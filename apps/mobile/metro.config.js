const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Polyfill Node.js core modules for React Native
// Required by jose → @privy-io/js-sdk-core → @privy-io/expo
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  crypto: require.resolve("expo-crypto"),
  buffer: require.resolve("@craftzdog/react-native-buffer"),
  stream: require.resolve("stream-browserify"),
  util: require.resolve("util"),
  assert: require.resolve("assert"),
  events: require.resolve("events"),
  url: require.resolve("url"),
};

module.exports = config;
