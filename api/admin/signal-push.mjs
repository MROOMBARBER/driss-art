import { createPushHandler } from './push.mjs';

// Shares the tested retry/lease/deduplication mechanism with announcement FCM.
// Each signal change has a unique immutable event => one push per change/device.
export default createPushHandler({
  collectionName: 'signalPushEvents',
  idField: 'eventId',
  notificationQuery: 'signal',
});
