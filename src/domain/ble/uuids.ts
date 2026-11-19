/**
 * 16-bit Bluetooth SIG assigned numbers (Assigned Numbers document, sections "GATT Services" and
 * "Characteristics"). Web Bluetooth accepts these numbers directly as service and characteristic
 * identifiers.
 */

export const SERVICE = {
  fitnessMachine: 0x1826,
  cyclingPower: 0x1818,
  cyclingSpeedCadence: 0x1816,
  heartRate: 0x180d,
  deviceInformation: 0x180a,
  battery: 0x180f,
} as const;

export const CHARACTERISTIC = {
  // Fitness Machine Service
  fitnessMachineFeature: 0x2acc,
  indoorBikeData: 0x2ad2,
  trainingStatus: 0x2ad3,
  supportedResistanceLevelRange: 0x2ad6,
  supportedPowerRange: 0x2ad8,
  fitnessMachineControlPoint: 0x2ad9,
  fitnessMachineStatus: 0x2ada,
  // Cycling Power Service
  cyclingPowerMeasurement: 0x2a63,
  cyclingPowerFeature: 0x2a65,
  // Cycling Speed and Cadence Service
  cscMeasurement: 0x2a5b,
  cscFeature: 0x2a5c,
  // Heart Rate Service
  heartRateMeasurement: 0x2a37,
  // Battery Service
  batteryLevel: 0x2a19,
} as const;

/** Full 128-bit UUID string for a 16-bit assigned number (Bluetooth Base UUID). */
export function fullUuid(short: number): string {
  return `0000${short.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
}
