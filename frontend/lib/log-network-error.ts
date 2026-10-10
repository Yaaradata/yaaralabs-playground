import config from './config';

export function logNetworkError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`${context}: ${message}. Backend is ${config.apiBaseUrl}. Start it if you are working locally.`);
}
