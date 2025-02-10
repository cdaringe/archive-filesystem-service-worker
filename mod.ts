/**
 * @module Capabilities to support streaming archives and building filemaps.
 */
import { entries as tarEntries } from "@zeb/streaming-tar";
import { contentType } from "@std/media-types";

export type FileByFilename = Map<string, Uint8Array>;
type ReadlableStreamUint8Array = ReadableStream<Uint8Array>;

const uriToReadableStream = async (
  uri: string
): Promise<ReadlableStreamUint8Array> => {
  const resp = await fetch(uri);
  const body = resp.body;
  if (!body || !resp.ok) {
    const msg = [
      "Failed to stream tarball.",
      uri,
      `${resp.status} // ${resp.statusText}`,
    ].join(" ");
    throw new Error(msg);
  }
  return body;
};

export const tarballUriToToFileMap = async (
  tarUri: string
): Promise<FileByFilename> => {
  const stream = await uriToReadableStream(tarUri);
  const fileMap: FileByFilename = new Map();
  const tarStream = stream.pipeThrough(new DecompressionStream("gzip"));
  for await (const entry of tarEntries(tarStream!)) {
    const body = new Uint8Array(await new Response(entry.body).arrayBuffer());
    fileMap.set(entry.name, body);
  }
  return fileMap;
};

export const getResponse = (
  filename: string,
  fileMap: FileByFilename
): null | Response => {
  const ext = filename.split(".").pop();
  const file =
    fileMap.get(filename) ?? filename.startsWith("/")
      ? fileMap.get(filename.substr(1))
      : null;
  if (!file || !ext) {
    return null;
  }

  const resolvedContentType = contentType(`.${ext}`);
  if (!resolvedContentType) {
    return null;
  }
  const headers = {
    "Content-Type": resolvedContentType,
    "Content-Length": file.byteLength.toString(),
  };
  return new Response(file, { headers });
};
