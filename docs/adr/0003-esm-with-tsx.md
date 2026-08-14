# ESM with tsx instead of CommonJS with ts-node

The project migrated from CommonJS + ts-node to native ESM + tsx to run the
TypeScript source. `package.json` `type` is `module`, tsconfig uses
`module: nodenext` with explicit `.js` extensions on relative imports and
`verbatimModuleSyntax` on, and the typecheck config is `noEmit`-only (no dist
build). ts-node was removed in favour of `tsx` because ts-node's ESM support
is awkward (loader flags, CommonJS default) while tsx is a drop-in that runs
ESM TypeScript natively.

## Considered options

- **CommonJS + ts-node (previous)**: worked, but keeps the project on a
  non-native module system that Node is moving away from; ESM under ts-node
  requires `node --loader ts-node/esm` and legacy loader warnings.
- **ESM + ts-node**: possible but brittle; ts-node's ESM story is a
  maintained-compat layer, not a native one.
- **ESM + tsx (chosen)**: tsx is a thin esbuild-based loader that runs ESM
  TypeScript directly, needs no config, and matches Node's native semantics.
- **moduleResolution bundler**: rejected — imports would stay extension-less
  (bundler semantics), which diverges from Node's real ESM resolution rules.

## Consequences

- All relative imports must carry `.js` extensions (resolved by tsx/vitest/tsc
  as TypeScript). This is a one-time mechanical change across `src/`.
- `__dirname` is gone; `import.meta.dirname` (Node ≥ 20.11) is used instead,
  with a single `PROJECT_ROOT` constant in `src/config.ts`.
- `tsc --noEmit` is now the typecheck-only entry point; `dist/` output config
  was removed since nothing compiles or publishes a build.
- Tests run under vitest, which natively supports ESM.
