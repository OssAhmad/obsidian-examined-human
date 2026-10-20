// Development-only loader for integration tests of the actual guarded service.
// Runtime plugin code continues to import Obsidian and embedded SQL/WASM normally.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'obsidian') {
      return { url: new URL('./obsidian-stub.mjs', import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.ts')) {
      return {
        format: 'module', shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
      };
    }
    if (url.endsWith('.sql')) {
      return { format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))};`, shortCircuit: true };
    }
    if (url.endsWith('.wasm')) {
      return { format: 'module', source: `export default Uint8Array.from(Buffer.from('${readFileSync(new URL(url)).toString('base64')}', 'base64'));`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
