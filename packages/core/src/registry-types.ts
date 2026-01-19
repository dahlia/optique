/**
 * Interface for dependency registry to break circular dependency between
 * parser.ts and dependency.ts.
 *
 * This interface defines the contract for storing and retrieving resolved
 * dependency values during parsing. The actual implementation is provided
 * by {@link DependencyRegistry} in dependency.ts.
 *
 * @since 0.10.0
 */
export interface DependencyRegistryLike {
  /**
   * Registers a resolved dependency value.
   * @param id The dependency ID (a unique symbol).
   * @param value The resolved value.
   */
  set<T>(id: symbol, value: T): void;

  /**
   * Gets a resolved dependency value.
   * @param id The dependency ID.
   * @returns The resolved value, or undefined if not found.
   */
  get<T>(id: symbol): T | undefined;

  /**
   * Checks if a dependency has been resolved.
   * @param id The dependency ID.
   * @returns `true` if the dependency has been resolved.
   */
  has(id: symbol): boolean;

  /**
   * Creates a copy of the registry.
   * @returns A new registry with the same values.
   */
  clone(): DependencyRegistryLike;
}
