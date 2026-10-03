// Runs the on-device model off the main thread so the page stays smooth while it thinks.
import { WebWorkerMLCEngineHandler } from '../../vendor/web-llm.mjs';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
