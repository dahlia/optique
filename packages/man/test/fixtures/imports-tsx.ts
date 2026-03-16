/**
 * Test fixture: .ts entry that re-exports from a .tsx file.
 * Exercises the fallback path where the entry itself is plain TypeScript
 * but a transitive dependency uses a JSX extension.
 */
export { default } from "./program.tsx";
