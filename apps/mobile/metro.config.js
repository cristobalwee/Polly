// Metro config: drives both the native bundle and the web bundle (Expo SDK 55
// serves web through Metro — the legacy webpack bundler has been removed).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withTamagui } = require('@tamagui/metro-plugin');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

// `isCSSEnabled` lets Metro handle CSS for the web build, which Tamagui's
// universal compiler relies on.
const config = getDefaultConfig(projectRoot, { isCSSEnabled: true });

// pnpm workspace wiring: watch the repo root so changes to `@polly/shared`
// trigger reloads, and let Metro resolve both local and hoisted node_modules.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// `withTamagui` plugs the Tamagui compiler into Metro so styling is resolved
// the same way for the native and web bundles.
module.exports = withTamagui(config, {
  components: ['tamagui'],
  config: './tamagui.config.ts',
});
