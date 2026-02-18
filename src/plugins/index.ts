/**
 * Coding Agent Hub — Plugin Entrypoints
 */

export { PluginRuntime, type PluginSelection } from './runtime.js';
export type {
  AgentPlugin,
  PluginCapabilitySnapshot,
  PluginInvocation,
  PluginRuntimeOptions,
  RuntimeInvocation,
  RuntimeInvocationContext,
  PluginDetectionContext,
  ContinuityMode,
} from './types.js';
export { LegacyAdapterPlugin } from './legacy-adapter-plugin.js';
export { detectCliHelpAndVersion, extractCliFlags, chooseFlag } from './cli-probe.js';
