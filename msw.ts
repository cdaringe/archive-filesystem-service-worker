/**
 * @module MSW tools for servicing files from archive files.
 */
import { getResponse, tarballUriToToFileMap } from "./mod.ts";

/**
 * A placeholder for the MSW module type
 */
interface IMSW {
  bypass: any;
  http: { all: any };
}

/**
 * A placeholder for the MSW handler context type
 */
interface MSWHandlerCtx {
  request: Request;
}

/**
 * A placeholder for the MSW handler interface
 */
// deno-lint-ignore no-empty-interface
interface MSWHandler {}

/**
 * Given a tarball URI, create a handler that will intercept files from
 * the tarball.
 */
export const createTarballFilesHandler = async <
  MSW extends IMSW,
  Handler extends MSWHandler
>(
  msw: MSW,
  tarUri: string
): Promise<Handler> => {
  const fileMap = await tarballUriToToFileMap(tarUri);
  return msw.http.all("*", (ctx: MSWHandlerCtx) => {
    const { request } = ctx;
    const pathname = new URL(request.url).pathname;
    const response = getResponse(pathname, fileMap);
    return response ? response : msw.bypass(request);
  });
};
