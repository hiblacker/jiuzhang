/** Real mode exposes only the implemented first-version workflows. */
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
