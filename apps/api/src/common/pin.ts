import bcrypt from 'bcryptjs';

const PIN_HASH_ROUNDS = 12;

export function hashPin(pin: string) {
  return bcrypt.hash(pin, PIN_HASH_ROUNDS);
}

export function verifyPin(pin: string, pinHash: string) {
  return bcrypt.compare(pin, pinHash);
}
