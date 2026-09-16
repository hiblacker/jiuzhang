import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
// These exact releases omit license files from their published tarballs.
const supplements = new Map([
  ['node_modules/css-render@0.15.14', 'css-render-MIT.txt'],
  ['node_modules/@css-render/plugin-bem@0.15.14', 'css-render-MIT.txt'],
  ['node_modules/@css-render/vue3-ssr@0.15.14', 'css-render-MIT.txt'],
  ['node_modules/vdirs@0.1.8', 'vdirs-MIT.txt'],
])
const sections = [
  'Jiuzhang Console - third-party notices\nThis file describes third-party packages only; it does not license the application.',
]
for (const [location, pkg] of Object.entries(lock.packages)) {
  if (!location || pkg.dev || pkg.optional) {
    continue
  }
  const directory = path.join(root, location)
  const names = (await readdir(directory)).filter(name =>
    /^(licen[sc]e|notice|copying)(\.|$)/i.test(name),
  )
  const texts = await Promise.all(names.map(name => readFile(path.join(directory, name), 'utf8')))
  if (!texts.length) {
    const supplement = supplements.get(`${location}@${pkg.version}`)
    if (!supplement || pkg.license !== 'MIT') {
      throw new Error(`MISSING_LICENSE_FILE: ${location}`)
    }
    texts.push(await readFile(path.join(root, 'licenses', supplement), 'utf8'))
  }
  sections.push(`${location} @ ${pkg.version} (${pkg.license})\n\n${texts.join('\n\n')}`)
}
await writeFile(
  path.join(root, 'dist/third-party-notices.txt'),
  sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n',
)
console.log(`Packaged notices for ${sections.length - 1} runtime dependencies.`)
