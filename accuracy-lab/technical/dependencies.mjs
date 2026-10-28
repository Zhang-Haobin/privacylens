import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
export function qaDependency(name) {
  try { return require(name); }
  catch (error) {
    if (!process.env.PRIVACYLENS_RUNTIME_MODULES) throw new Error(`QA requires ${name}. Set PRIVACYLENS_RUNTIME_MODULES to an existing Node modules directory.`, { cause: error });
    return require(join(process.env.PRIVACYLENS_RUNTIME_MODULES, name));
  }
}
