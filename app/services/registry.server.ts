/**
 * Registers all background job handlers and starts the worker.
 * Imported once from entry.server.tsx.
 */
import "./themeMerge.server";
import { ensureWorker } from "./jobs.server";

ensureWorker();
