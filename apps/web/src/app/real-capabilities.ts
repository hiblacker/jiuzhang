/** Only routes backed by the current API are exposed as product workflows. */
export function supportsRealRoute(path: string): boolean {
  return [
    '/overview',
    '/sources',
    '/datasets',
    '/runs',
    '/warehouse/overview',
    '/warehouse/tables',
    '/warehouse/query',
    '/warehouse/exports',
    '/governance/quality',
    '/governance/masking',
    '/system/users',
    '/system/audit',
    '/403',
    '/404',
  ].some((root) => path === root || path.startsWith(root + '/'))
}
