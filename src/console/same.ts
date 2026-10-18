/**
 * `true` only while `A` and `B` are the same type, in both directions.
 *
 * The Console's structural declarations (`api-types.ts`) are what the page's
 * tsconfig can compile — it has no node types, so it cannot import the modules
 * the real contracts live in. This type is how each side checks its declaration
 * against the real one: a field added, dropped or retyped on either side turns
 * the check's argument type into `never`, so the mismatch stops compiling
 * instead of letting the page silently lose a field.
 */
export type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
