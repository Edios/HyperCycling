/**
 * CRC-16 used by FIT files (header and file): the reflected polynomial 0xA001 (CRC-16/ARC),
 * start value 0, no final xor, low byte first. Written from the public file format description;
 * the check value of "123456789" is 0xBB3D.
 */

const TABLE: readonly number[] = Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  return crc;
});

/** CRC-16 of `bytes`, continuing from `crc` (0 to start). */
export function crc16(bytes: ArrayLike<number>, crc = 0): number {
  let value = crc & 0xffff;
  for (let i = 0; i < bytes.length; i += 1) {
    value = (value >>> 8) ^ (TABLE[(value ^ (bytes[i] ?? 0)) & 0xff] ?? 0);
  }
  return value & 0xffff;
}
