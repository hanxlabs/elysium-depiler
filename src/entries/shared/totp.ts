export async function generateTotp(secret: string, minimumValiditySeconds = 5): Promise<string> {
  const normalized = normalizeSecret(secret);
  if (!/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error("2FA密钥格式无效");
  }
  const keyBytes = base32Decode(normalized);
  if (!keyBytes.length) {
    throw new Error("2FA密钥格式无效");
  }

  let now = Date.now();
  const remainingSeconds = 30 - (Math.floor(now / 1000) % 30);
  if (remainingSeconds <= minimumValiditySeconds) {
    await new Promise((resolve) => setTimeout(resolve, (remainingSeconds + 0.1) * 1000));
    now = Date.now();
  }

  const keyData = Uint8Array.from(keyBytes).buffer;
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = Math.floor(now / 1000 / 30);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(4, counter);
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
  const offset = hash[hash.length - 1] & 0xf;
  const binary = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(binary % 1000000).padStart(6, "0");
}

function normalizeSecret(secret: string): string {
  let value = secret.trim();
  if (/^otpauth:\/\//i.test(value)) {
    const parsed = new URL(value);
    value = parsed.searchParams.get("secret") ?? "";
  }
  return value.replace(/[\s=-]/g, "").toUpperCase();
}

function base32Decode(value: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let bits = 0;
  let bitBuffer = 0;
  for (const char of value) {
    const index = alphabet.indexOf(char);
    if (index < 0) {
      throw new Error("2FA密钥格式无效");
    }
    bitBuffer = (bitBuffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((bitBuffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}
