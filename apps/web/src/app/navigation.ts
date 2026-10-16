import { routeManifest } from './route-manifest'
const entries = routeManifest.filter((route) => 'menu' in route && route.menu)
export const navigation = [...new Set(entries.map((route) => route.section))].map((section) => ({
  key: section,
  icon: section,
  entries: entries.filter((route) => route.section === section),
}))
