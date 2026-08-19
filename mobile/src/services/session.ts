/**
 * The ISO timestamp of when this app process started (module load ≈ app launch). The Import screen
 * uses it to show only transactions added THIS session — imports stamp every row's `createdAt` with
 * the import time, which is always ≥ this marker. Survives screen remounts (module-level), resets on
 * a real app restart.
 */
export const SESSION_START = new Date().toISOString();
