import * as tar from "@zeb/streaming-tar";
import * as mimes from "@geacko/mimes";
import { Result } from "@result/result";
import { AsyncResult } from "./async_result.ts";

export type FileByFilename = Map<string, Uint8Array>;

type FileByFilenameResult = Result<FileByFilename, string>;

type ReadlableStreamResult = Result<ReadableStream<Uint8Array>, string>;

const uriToReadableStream = async (uri: string): Promise<ReadlableStreamResult> => {
  const resp: Result<Response, string> = await fetch(uri).then(
    (resp) => Result.ok(resp),
    (err) => Result.err(String(err))
  );
  return resp.andThen((resp) => {
    const body = resp.body;
    if (!body) {
      return Result.err("tarball has no body");
    }
    return Result.ok(body);
  });
};

export const tarballUriToToFileMap = async (tarUri: string): Promise<FileByFilenameResult> => {
  const binaryStreamResult = await uriToReadableStream(tarUri);
  return AsyncResult.fromPromiseResult(
    binaryStreamResult.match(
      async (stream) => {
        const fileMap: FileByFilename = new Map();
        try {
          const tarStream = stream.pipeThrough(new DecompressionStream("gzip"));
          for await (const entry of tar.entries(tarStream!)) {
            // read the entry.body ReableStream<Uint8Array> to Uint8Array using
            // standard web apis
            const body = new Uint8Array(await new Response(entry.body).arrayBuffer());
            fileMap.set(entry.name, body);
          }
        } catch (err) {
          return Result.err(String(err));
        }
        return Result.ok(fileMap);
      },
      // deno-lint-ignore require-await
      async (err) => Result.err(err)
    )
  );
};

export const getResponse = (filename: string, fileMap: FileByFilename): Result<null | Response, "unsupported"> => {
  const ext = filename.split(".").pop();
  const file = fileMap.get(filename);
  if (!file || !ext) {
    return Result.ok(null);
  }

  const mime = mimes.lookup(ext);
  if (!mime) {
    return Result.err("unsupported");
  }
  const { type: mimeType, isUtf8 } = mime;
  const contentType = `${mimeType}${isUtf8 ? "; charset=UTF-8" : ""}`;
  const headers = {
    "Content-Type": contentType,
    "Content-Length": file.byteLength.toString(),
  };
  return Result.ok(new Response(file, { headers }));
};
