/** The ride import worker: reads a ride file off the main thread. Started by `read-ride-file.ts`. */

import { handleRideImportRequest, transferablesOf, type RideImportRequest } from './protocol';

self.onmessage = async (event: MessageEvent<RideImportRequest>) => {
  const response = await handleRideImportRequest(event.data);
  self.postMessage(response, { transfer: transferablesOf(response) });
};
