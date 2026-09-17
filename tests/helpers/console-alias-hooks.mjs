import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP = new URL('../../apps/console/', import.meta.url);
const SRC = new URL('src/', APP);

function firstFile(candidates) {
  for (const candidate of candidates) {
    try {
      if (statSync(fileURLToPath(candidate)).isFile()) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * TypeScript-style resolution for the console unit tests: the application uses the '@/' alias and
 * extensionless relative imports, which Vite and TypeScript resolve but plain Node does not. The
 * hook resolves both so tests load the very same files the bundle does.
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const base = new URL(specifier.slice(2), SRC);
    const resolved = firstFile([`${base.href}.ts`, `${base.href}/index.ts`, base.href]);
    return next(resolved ?? specifier, context);
  }
  // Bare packages come from the console's dependency tree, which is the one the app builds with.
  if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('node:')) {
    const installed = new URL(`node_modules/${specifier}`, APP);
    try {
      statSync(fileURLToPath(installed));
      return next(specifier, { ...context, parentURL: installed.href });
    } catch {
      /* fall through to the default resolution */
    }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    const resolved = firstFile([`${base.href}.ts`, `${base.href}/index.ts`]);
    if (resolved) return next(resolved, context);
  }
  return next(specifier, context);
}
