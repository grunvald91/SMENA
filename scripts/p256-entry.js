import { p256 } from '@noble/curves/nist.js';
export function validateP256PublicKey(bytes) {
  p256.Point.fromBytes(bytes).assertValidity();
}
export function verifyP256(signature, message, publicKey) {
  // WebCrypto uses compact IEEE P1363 and permits either value of s.
  return p256.verify(signature, message, publicKey, { prehash: true, lowS: false, format: 'compact' });
}
