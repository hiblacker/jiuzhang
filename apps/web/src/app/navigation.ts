import { routeManifest } from './route-manifest'
import { supportsRealRoute } from './real-capabilities'
const entries = routeManifest.filter(
  (route) =>
    'menu' in route &&
    route.menu &&
    (import.meta.env.VITE_API_MODE !== 'real' || supportsRealRoute(route.path)),
)
export const navigation = [...new Set(entries.map((route) => route.section))].map((section) => ({
  key: section,
  icon: section,
  entries: entries.filter((route) => route.section === section),
}))
