// Metro config for a monorepo: watch the workspace root so Metro transpiles the
// @lyftr/shared TypeScript source, and resolve modules from both the app's and the
// root's node_modules. Wrapped with NativeWind's metro transform.
const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
// Prefer the app's copy of singletons (react, react-native) to avoid duplicates.
config.resolver.disableHierarchicalLookup = false

module.exports = withNativeWind(config, { input: './global.css' })
