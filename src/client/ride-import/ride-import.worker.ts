/** The ride import worker: reads a ride file off the main thread. Started by `read-ride-file.ts`. */

import { handleRideImportRequest, type RideImportRequest } from './protocol';

self.onmessage = (event: MessageEvent<RideImportRequest>) => {
  self.postMessage(handleRideImportRequest(event.data));
};
