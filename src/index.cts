const { transformSync } = require('@swc/core');
const { readFileSync, existsSync } = require('fs');
const { resolve, dirname, extname } = require('path');
const { Module } = require('module');

type LoadTSConfig = null | { paths: Record<string, string[]>; baseUrl: string };
const extensions = ['.cjs', '.cts', '.js', '.ts', '.jsx', '.tsx'];

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

  return importPath;
}

function transformer(source: string, ext: string) {
  const { code } = transformSync(source, {
    sourceMaps: false,
    module: {
      type: 'commonjs',
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
  return code
    .replace(
      /^\s*(?:const|let|var)\s+.*?=\s*require\(\s*['"][^'"]+\.(svg|bmp|ico|gif|png|jpeg|jpg|webp|avif|astro|vue|svelte|css|scss)['"]\s*\)\s*;?\s*$/gm,
      ''
    )
    .replace(/(?:const|let|var)\s*({[^}]+}|[\w$_]+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\s*;?/g, (_match, requireClause, requirePath) => {
      let resolvedPath = resolveImportPath(requirePath, tsConfig, basePath);

      if (!extname(resolvedPath)) {
        for (const ext of extensions) {
          if (existsSync(resolvedPath + ext)) {
            resolvedPath += ext;
            break;
          }
        }
      }

      if (!existsSync(resolvedPath)) {
        const requireStatement = `const ${requireClause} = require('${requirePath}');`;
        externalImportSet.add(requireStatement);
        return '';
      }

      return `const ${requireClause} = require('${resolvedPath}');`;
    });
}

function kpx(filePath: string): string {
  const absoluteFilePath = resolve(filePath);

  const extMatch = filePath.match(/(\.(?:cjs|cts|js|ts|jsx|tsx))$/);
  if (!extMatch) throw new Error('Unsupported file extension');
  const ext = extMatch[1];

  const source = readFileSync(absoluteFilePath, 'utf-8');
  const transformedCode = ext === '.js' || ext === '.cjs' || ext === '.jsx' ? source : transformer(source, ext);

  const externalImportSet: Set<string> = new Set();
  const resolvedCode = resolveImports(transformedCode, absoluteFilePath, externalImportSet);

  const finalBundle = [...externalImportSet].join('\n') + '\n' + resolvedCode.trim();
  return finalBundle;
}

function register() {
  const requireExt = Module._extensions;
  const targetExtensions = ['.ts', '.tsx', '.cts'];

  targetExtensions.forEach(ext => {
    requireExt[ext] = function (module: any, filename: string) {
      if (filename.includes('node_modules')) {
        return requireExt['.js'](module, filename);
      }
      const compiledCode = kpx(filename);
      module._compile(compiledCode, filename);
    };
  });
}

module.exports = { register };
