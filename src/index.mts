import { transformSync } from '@swc/core';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, extname, join, normalize, relative } from 'path';
import { LoadHook } from 'module';
import { pathToFileURL } from 'url';

type LoadTSConfig = null | { paths: Record<string, string[]>; baseUrl: string };
const extensions = ['.mjs', '.mts', '.js', '.ts', '.jsx', '.tsx'];

function findProjectRoot() {
  let currentDir = process.cwd();
  while (!existsSync(resolve(currentDir, 'package.json'))) {
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return currentDir;
    currentDir = parentDir;
  }
  return currentDir;
}

const projectRoot = findProjectRoot();

function loadTsConfig(): LoadTSConfig {
  const tsConfigPath = resolve(projectRoot, 'tsconfig.json');
  if (!existsSync(tsConfigPath)) return null;
  try {
    const config = JSON.parse(readFileSync(tsConfigPath, 'utf-8'));
    return config.compilerOptions || null;
  } catch (e) {
    return null;
  }
}

function resolveImportPath(importPath: string, tsConfig: LoadTSConfig, basePath?: string) {
  if (importPath.startsWith('.')) {
    if (!basePath) {
      throw new Error('basePath is required for relative imports');
    }
    return resolve(dirname(basePath), importPath);
  }

  if (tsConfig) {
    const { baseUrl, paths } = tsConfig;
    if (baseUrl) {
      const baseDir = resolve(projectRoot, baseUrl);

      if (paths) {
        for (const [alias, targetPaths] of Object.entries(paths)) {
          const aliasPrefix = alias.replace(/\*$/, '');
          if (importPath.startsWith(aliasPrefix)) {
            for (const target of targetPaths) {
              const resolvedTarget = target.replace(/\*$/, '');
              const candidatePath = resolve(baseDir, resolvedTarget + importPath.slice(aliasPrefix.length));
              for (const ext of extensions) {
                if (existsSync(candidatePath + ext)) {
                  return candidatePath + ext;
                }
              }

              if (existsSync(candidatePath)) {
                return candidatePath;
              }
            }
          }
        }
      }

      const fromBaseUrlPath = resolve(baseDir, importPath);
      if (existsSync(fromBaseUrlPath)) {
        return fromBaseUrlPath;
      }
    }
  }

  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    const nodeModulesPath = resolve(projectRoot, 'node_modules', importPath);
    const indexJsPath = join(nodeModulesPath, 'index.js');
    const indexMjsPath = join(nodeModulesPath, 'index.mjs');

    if (existsSync(indexJsPath)) {
      return indexJsPath;
    } else if (existsSync(indexMjsPath)) {
      return indexMjsPath;
    }

    const jsFilePath = `${nodeModulesPath}.js`;
    const mjsFilePath = `${nodeModulesPath}.mjs`;

    if (existsSync(jsFilePath)) {
      return jsFilePath;
    } else if (existsSync(mjsFilePath)) {
      return mjsFilePath;
    }
  }

  return importPath;
}

function transformer(source: string, ext: string) {
  const { code } = transformSync(source, {
    sourceMaps: false,
    module: {
      type: 'es6',
    },
    jsc: {
      parser: { syntax: 'typescript', tsx: ext.endsWith('.tsx') },
      target: 'es2022',
    },
  });

  return code;
}

function resolveImports(code: string, basePath: string, externalImportSet: Set<string>): string {
  const tsConfig = loadTsConfig();
  // dotAll mode allows .*? to match newlines
  return code // Remove import lines for image files (svg, png, jpeg, jpg, gif, webp, vue, svelte)
    .replace(/^\s*import\s+(?:.*?\s+from\s+)?['"][^'"]+\.(?:svg|bmp|ico|gif|png|jpeg|jpg|webp|avif|astro|vue|svelte|css|scss)['"]\s*;?\s*$/gm, '')
    .replace(/import\s+(.*?)\s+from\s+['"]([^'"]+)['"]\s*;?/g, (_match, importClause, importPath) => {
      let resolvedPath = resolveImportPath(importPath, tsConfig, basePath);

      if (!extname(resolvedPath)) {
        for (const ext of extensions) {
          if (existsSync(resolvedPath + ext)) {
            resolvedPath += ext;
            break;
          }
        }
      }

      if (!existsSync(resolvedPath)) {
        const importStatement = `import ${importClause} from '${importPath}';`;
        externalImportSet.add(importStatement);
        return '';
      }

      const resolvedPathUrl = pathToFileURL(resolvedPath).href;
      return `import ${importClause} from '${resolvedPathUrl}';`;
    });
}

export async function kpx(filePath: string): Promise<string> {
  const absoluteFilePath = normalize(resolve(filePath));

  const extMatch = filePath.match(/(\.(?:mjs|mts|js|ts|jsx|tsx))$/);
  if (!extMatch) throw new Error('Unsupported file extension');
  const ext = extMatch[1];

  const source = readFileSync(absoluteFilePath, 'utf-8');
  const transformedCode = ext === '.js' || ext === '.mjs' || ext === 'jsx' ? source : transformer(source, ext);

  const externalImportSet: Set<string> = new Set();
  const resolvedCode = resolveImports(transformedCode, absoluteFilePath, externalImportSet);

  const finalBundle = [...externalImportSet].join('\n') + '\n' + resolvedCode.trim();
  return finalBundle;
}

export const load: LoadHook = async (url, context, nextLoad) => {
  const fileUrl = new URL(url);
  const filePath = fileUrl.pathname;
  const ext = extname(filePath);

  if (filePath.includes('node_modules') || !extensions.includes(ext)) {
    return nextLoad(url, context);
  }

  const compiledCode = await kpx(filePath);

  return {
    format: 'module',
    source: compiledCode,
    shortCircuit: true,
  };
};
