import { realpathSync } from "node:fs";

/**
 * Options for checking whether an ESM module is the process entry point.
 *
 * @internal
 * @since 1.2.0
 */
export interface MainModuleOptions {
  /**
   * `import.meta.main` when the current runtime provides it.
   */
  readonly importMetaMain?: boolean;

  /**
   * Path to the current module.
   */
  readonly modulePath: string;

  /**
   * Process entry-point path.
   */
  readonly argvEntry?: string;

  /**
   * Function used to resolve symlinks.
   */
  readonly realpath?: (path: string) => string;
}

/**
 * Checks whether a module is the current process entry point.
 *
 * @param options Main-module check inputs.
 * @returns Whether the module should run as the process entry point.
 * @internal
 * @since 1.2.0
 */
export function isMainModule(options: MainModuleOptions): boolean {
  if (options.importMetaMain != null) return options.importMetaMain;
  if (options.argvEntry == null) return false;
  const realpath = options.realpath ?? realpathSync;
  return realpathOrOriginal(options.argvEntry, realpath) ===
    realpathOrOriginal(options.modulePath, realpath);
}

function realpathOrOriginal(
  path: string,
  realpath: (path: string) => string,
): string {
  try {
    return realpath(path);
  } catch {
    return path;
  }
}
