import { createTarballFilesHandler } from "./msw.ts";
const msw = (globalThis as any).MockServiceWorker;

const { setupWorker } = msw;

(globalThis as any).setupTarballInterceptorWorker = async (url: string) => {
  const handler = await createTarballFilesHandler(msw, url);
  const worker = setupWorker(handler);
  worker.start();
};
