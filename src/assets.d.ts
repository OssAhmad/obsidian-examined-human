declare module '*.wasm' {
  const bytes: Uint8Array;
  export default bytes;
}

declare module '*.sql' {
  const sql: string;
  export default sql;
}
