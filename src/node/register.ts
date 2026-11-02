import { startTelemetry } from './index.js';

// Side-effect entry for `node --require @ablecredit/telemetry/node/register app.js`.
// Configuration comes entirely from environment variables (see docs/configuration.md).
startTelemetry();
