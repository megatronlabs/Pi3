export { ConfigSchema, defaultConfig, ROLE_NAMES } from './schema'
export type { SwarmConfig, RoleName, RoleAssignment, PartialRoleMap } from './schema'
export { loadConfig, saveConfig, initConfig, resolveProviderKey, resolveBaseUrl, CONFIG_DIR, CONFIG_PATH } from './loader'
export { resolveRole, resolveAllRoles, listPresets, BUILT_IN_PRESETS } from './roles'
