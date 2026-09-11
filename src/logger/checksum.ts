function toHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function arrayBufferFrom(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', arrayBufferFrom(bytes));
  return toHex(new Uint8Array(digest));
}

export function sha256Text(text: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(text));
}
