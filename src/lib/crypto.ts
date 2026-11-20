// Real WebCrypto ECDH P-256 + AES-GCM 256-bit End-to-End Encryption Helper
// Private keys are stored in browser IndexedDB (never localStorage or server).

const DB_NAME = 'tiger_e2ee_keystore';
const STORE_NAME = 'keys';

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function ensureUserE2EEKeyPair(userId: number): Promise<{
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey;
  fingerprint: string;
}> {
  const storeKey = `ecdh_pair_${userId}`;
  const existing = await idbGet<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }>(storeKey);

  if (existing) {
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      existing.privateJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );
    const fingerprint = await computeKeyFingerprint(existing.publicJwk);
    return { publicKeyJwk: existing.publicJwk, privateKey, fingerprint };
  }

  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );

  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await idbSet(storeKey, { publicJwk, privateJwk });

  const fingerprint = await computeKeyFingerprint(publicJwk);
  return { publicKeyJwk: publicJwk, privateKey: pair.privateKey, fingerprint };
}

export async function computeKeyFingerprint(jwk: JsonWebKey): Promise<string> {
  const raw = new TextEncoder().encode(`${jwk.x || ''}:${jwk.y || ''}`);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase();
}

async function deriveSharedAesKey(myPrivateKey: CryptoKey, peerPublicJwk: JsonWebKey): Promise<CryptoKey> {
  const peerPublicKey = await crypto.subtle.importKey(
    'jwk',
    peerPublicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessageE2EE(
  plaintext: string,
  myPrivateKey: CryptoKey,
  peerPublicJwk: JsonWebKey,
  myFingerprint: string
) {
  const aesKey = await deriveSharedAesKey(myPrivateKey, peerPublicJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(cipherBuffer))),
    iv: btoa(String.fromCharCode(...iv)),
    senderKeyFingerprint: myFingerprint,
    algorithm: 'ECDH-P256-AES-GCM-256',
  };
}

export async function decryptMessageE2EE(
  payload: { ciphertext: string; iv: string },
  myPrivateKey: CryptoKey,
  peerPublicJwk: JsonWebKey
): Promise<string> {
  const aesKey = await deriveSharedAesKey(myPrivateKey, peerPublicJwk);
  const cipherBytes = Uint8Array.from(atob(payload.ciphertext), (c) => c.charCodeAt(0));
  const ivBytes = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, aesKey, cipherBytes);
  return new TextDecoder().decode(plainBuffer);
}
