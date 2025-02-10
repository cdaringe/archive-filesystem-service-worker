// https://jsr.io/@zeb/streaming-tar/0.1.1/deferred.ts
var Deferred = class {
  promise;
  resolve;
  constructor() {
    this.promise = new Promise((r) => this.resolve = r);
  }
};

// https://jsr.io/@zeb/streaming-tar/0.1.1/entry.ts
var EntryImpl = class {
  #header;
  #reader;
  #whenDone;
  #buffered;
  bodyUsed = false;
  constructor(header, reader, buffered, whenDone) {
    this.#header = header;
    this.#reader = reader;
    this.#whenDone = whenDone;
    this.#buffered = buffered.length > 0 ? buffered : void 0;
  }
  get name() {
    return this.#header.name;
  }
  get fileSize() {
    return this.#header.fileSize;
  }
  get #withinEntry() {
    let remaining = Math.ceil(this.#header.fileSize / 512) * 512;
    return new ReadableStream({
      start: () => {
        if (this.bodyUsed) {
          throw new Error("Body already used");
        }
        this.bodyUsed = true;
      },
      pull: async (controller) => {
        if (remaining === 0) {
          controller.close();
          return;
        }
        let chunk;
        if (this.#buffered) {
          chunk = this.#buffered;
          this.#buffered = void 0;
        } else {
          const result = await this.#reader.read();
          if (result.done) {
            controller.error(new Error("Unexpected end of stream"));
            return;
          }
          chunk = result.value;
        }
        const chunkWithinEntry = Math.min(remaining, chunk.length);
        controller.enqueue(chunk.slice(0, chunkWithinEntry));
        remaining -= chunkWithinEntry;
        if (remaining === 0) {
          this.#whenDone(chunk.slice(chunkWithinEntry));
          controller.close();
        }
      }
    });
  }
  get body() {
    let remaining = this.#header.fileSize;
    const reader = this.#withinEntry.getReader();
    return new ReadableStream({
      pull: async (controller) => {
        if (remaining === 0) {
          controller.close();
          return;
        }
        const result = await reader.read();
        if (result.done) {
          controller.error(new Error("Unexpected end of stream"));
          return;
        }
        const chunk = result.value;
        const chunkWithinEntry = Math.min(remaining, chunk.length);
        controller.enqueue(chunk.slice(0, chunkWithinEntry));
        remaining -= chunkWithinEntry;
        if (remaining === 0) {
          while (!(await reader.read()).done) {
          }
          controller.close();
        }
      }
    });
  }
  async skip() {
    const reader = this.#withinEntry.getReader();
    while (!(await reader.read()).done) {
    }
  }
  async arrayBuffer() {
    const reader = this.body.getReader();
    const buffer = new Uint8Array(this.#header.fileSize);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await reader.read();
      if (result.done) {
        throw new Error("Unexpected end of stream");
      }
      buffer.set(result.value, offset);
      offset += result.value.length;
    }
    return buffer.buffer;
  }
  async json(encoding = "utf-8") {
    const text = await this.text(encoding);
    return JSON.parse(text);
  }
  async text(encoding = "utf-8") {
    const bytes = await this.arrayBuffer();
    return new TextDecoder(encoding).decode(bytes);
  }
};

// https://jsr.io/@zeb/streaming-tar/0.1.1/header.ts
var textDecoder = new TextDecoder();
var Header = class {
  #data;
  constructor(data) {
    this.#data = data;
  }
  get name() {
    const rawBytes = this.#data.slice(0, 100);
    let lastNonNul = 0;
    for (let i = 0; i < rawBytes.length; i++) {
      if (rawBytes[i] !== 0) {
        lastNonNul = i;
      } else {
        break;
      }
    }
    return textDecoder.decode(rawBytes.slice(0, lastNonNul + 1));
  }
  get fileSize() {
    const sizeBytes = this.#data.slice(124, 136);
    return parseInt(textDecoder.decode(sizeBytes), 8);
  }
  get checksum() {
    const checksumBytes = this.#data.slice(148, 156);
    return parseInt(textDecoder.decode(checksumBytes), 8);
  }
};

// https://jsr.io/@zeb/streaming-tar/0.1.1/mod.ts
var initialChecksum = 8 * 32;
function computeChecksum(bytes) {
  let sum = initialChecksum;
  for (let i = 0; i < 512; i++) {
    if (i >= 148 && i < 156) {
      continue;
    }
    sum += bytes[i];
  }
  return sum;
}
async function* entries(tarStream) {
  const reader = tarStream.getReader();
  const headerBytes = new Uint8Array(512);
  let headerBytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    let chunk = value;
    while (chunk.length > 0) {
      const remainingHeaderBytes = 512 - headerBytesRead;
      const headerChunk = chunk.slice(0, remainingHeaderBytes);
      chunk = chunk.slice(remainingHeaderBytes);
      headerBytes.set(headerChunk, headerBytesRead);
      headerBytesRead += headerChunk.length;
      if (headerBytesRead === 512) {
        const header = new Header(headerBytes);
        if (computeChecksum(headerBytes) !== header.checksum) {
          return;
        }
        const { resolve, promise } = new Deferred();
        yield new EntryImpl(header, reader, chunk, resolve);
        if (header.fileSize > 0) {
          chunk = await promise;
        }
        headerBytesRead = 0;
      }
    }
  }
}

// https://jsr.io/@geacko/mimes/1.0.3/src/mimes.ts
var mimeToExtMap = /* @__PURE__ */ new Map();
var extToMimeMap = /* @__PURE__ */ new Map();
var db = await (await fetch(`https://cdn.jsdelivr.net/gh/jshttp/mime-db@master/db.json`)).json();
Object.keys(db).forEach((t) => {
  const {
    extensions,
    compressible,
    charset
  } = db[t];
  if (extensions && extensions.length != 0) {
    mimeToExtMap.set(t, Object.freeze(extensions));
    const m = Object.freeze({
      isUtf8: charset == "UTF-8",
      isCompressible: compressible == true,
      type: t,
      contentType: t + (charset == "UTF-8" ? "; charset=UTF-8" : "")
    });
    for (const e of extensions) {
      extToMimeMap.set(e, m);
    }
  }
});
function lookup(pathOrExt) {
  const i = pathOrExt.lastIndexOf(".");
  if (i == -1) {
    return void 0;
  }
  return extToMimeMap.get(
    pathOrExt.substring(i + 1)
  );
}

// https://jsr.io/@result/result/1.1.0/result.ts
var Panic = class extends Error {
  constructor(message, cause) {
    super(message, { cause });
  }
};
var Result = class _Result {
  constructor(innerResult) {
    this.innerResult = innerResult;
  }
  static none = Symbol("none");
  static ok(value) {
    return new _Result({
      success: true,
      value
    });
  }
  static err(value) {
    return new _Result({
      success: false,
      value
    });
  }
  /**
   * Returns `true` if the result is {@linkcode Ok}.
   *
   * @example
   * ```ts
   * import { assertEquals } from "jsr:@std/assert@1";
   *
   * const x: Result<number, string> = Result.ok(-3);
   * assertEquals(x.isOk(), true);
   *
   * const y: Result<number, string> = Result.err("Some error message");
   * assertEquals(y.isOk(), false);
   * ```
   */
  isOk() {
    return this.innerResult.success;
  }
  /**
   * Returns `true` if the result is {@linkcode Ok} and the value inside of it matches a predicate.
   *
   * @example
   * ```ts
   * import { assertEquals } from "jsr:@std/assert@1";
   *
   * const x: Result<number, string> = Result.ok(2);
   * assertEquals(x.isOkAnd((x) => x > 1), true);
   *
   * const y: Result<number, string> = Result.ok(2);
   * assertEquals(y.isOkAnd((y) => y < 0), false);
   *
   * const z: Result<number, string> = Result.err("hey");
   * assertEquals(z.isOkAnd((z) => z > 1), false);
   * ```
   */
  isOkAnd(f) {
    return this.match(
      (value) => f(value),
      () => false
    );
  }
  /**
   * Returns `true` if the result is {@linkcode Err}.
   *
   * @example
   * ```ts
   * import { assertEquals } from "jsr:@std/assert@1";
   *
   * const x: Result<number, string> = Result.ok(-3);
   * assertEquals(x.isErr(), false);
   *
   * const y: Result<number, string> = Result.err("Some error message");
   * assertEquals(y.isErr(), true);
   * ```
   */
  isErr() {
    return !this.innerResult.success;
  }
  /**
   * Returns `true` if the result is {@linkcode Err} and the value inside of it matches a predicate.
   *
   * @example
   * ```ts
   * import { assertEquals } from "jsr:@std/assert@1";
   *
   * const x: Result<number, string> = Result.err("Some error message");
   * assertEquals(x.isErrAnd((x) => x === "Some error message"), true);
   *
   * const y: Result<number, string> = Result.err("Another error message");
   * assertEquals(y.isErrAnd((y) => y === "Some error message"), false);
   *
   * const z: Result<number, string> = Result.ok(123);
   * assertEquals(z.isErrAnd((z) => z === "Some error message"), false);
   * ```
   */
  isErrAnd(f) {
    return this.match(
      () => false,
      (err2) => f(err2)
    );
  }
  ok(noneSymbol) {
    if (this.innerResult.success) {
      return this.innerResult.value;
    }
    if (noneSymbol) {
      return _Result.none;
    } else {
      return null;
    }
  }
  err(noneSymbol) {
    if (!this.innerResult.success) {
      return this.innerResult.value;
    }
    if (noneSymbol) {
      return _Result.none;
    } else {
      return null;
    }
  }
  /**
   * Maps a Result<T, E> to Result<U, E> by applying a function to a contained Ok value, leaving an Err value untouched.
   * This function can be used to compose the results of two functions.
   *
   * @example
   * ```ts
   * import { assertEquals } from "jsr:@std/assert@1";
   *
   * const x: Result<number, string> = Result.ok(100);
   * assertEquals(x.map((i) => i * 2).unwrap(), 200);
   *
   * const z: Result<number, string> = Result.err("Some error message");
   * assertEquals(z.map((i) => i * 2), "Some error message");
   * ```
   */
  map(op) {
    return this.match(
      (value) => _Result.ok(op(value)),
      () => this
    );
  }
  mapOr(defaultValue, f) {
    return this.match(
      (value) => f(value),
      () => defaultValue
    );
  }
  mapOrElse(defaultValue, f) {
    return this.match(
      (value) => f(value),
      (error) => defaultValue(error)
    );
  }
  mapErr(op) {
    return this.match(
      () => this,
      (error) => _Result.err(op(error))
    );
  }
  inspect(f) {
    if (this.innerResult.success) {
      f(this.innerResult.value);
    }
    return this;
  }
  inspectErr(f) {
    if (!this.innerResult.success) {
      f(this.innerResult.value);
    }
    return this;
  }
  and(res) {
    return this.match(
      () => res,
      () => this
    );
  }
  andThen(op) {
    return this.match(
      (value) => op(value),
      () => this
    );
  }
  or(res) {
    return this.match(
      () => this,
      () => res
    );
  }
  orElse(op) {
    return this.match(
      () => this,
      (error) => op(error)
    );
  }
  /**
   * Returns the contained {@linkcode Ok} value.
   * Because this function throw {@linkcode Panic}, its use is generally discouraged. Instead, prefer to use {@linkcode Result.prototype.match} and handle the Err case explicitly, or call {@linkcode Result.prototype.unwrapOr}, {@linkcode Result.prototype.unwrapOrElse}.
   *
   * @example
   * ```ts
   * import { assertEquals } from "jsr:@std/assert@1";
   *
   * const x: Result<number, string> = Result.ok(2);
   * assertEquals(x.unwrap(), 2);
   * ```
   *
   * @example
   * ```ts
   * import { assertThrows } from "jsr:@std/assert@1";
   *
   * const x: Result<number, string> = Result.err("Some error message");
   * assertThrows(() => x.unwrap());
   * ```
   *
   * @throws {Panic} if the value is an {@linkcode Err}, with a panic message provided by the Err’s value.
   */
  unwrap() {
    return this.match(
      (value) => value,
      (error) => {
        throw new Panic("called `Result.unwrap()` on an `Err`", error);
      }
    );
  }
  unwrapErr() {
    return this.match(
      (value) => {
        throw new Panic("called `Result.unwrapErr()` on an `Ok`", value);
      },
      (error) => error
    );
  }
  unwrapOr(defaultValue) {
    return this.match(
      (value) => value,
      () => defaultValue
    );
  }
  unwrapOrElse(defaultValue) {
    return this.match(
      (value) => value,
      () => defaultValue()
    );
  }
  orThrow() {
    return this.match(
      (value) => value,
      (error) => {
        throw error;
      }
    );
  }
  /**
   * Methods that can be used similarly to the Match statement, a Rust expression.
   *
   * @example
   * ```ts
   * import { assertEquals } from "jsr:@std/assert@1";
   *
   * const x: Result<number, string> = Result.ok(123);
   * const number = x.match(
   *   (x) => x,
   *   (_) => 0
   * );
   *
   * assertEquals(number, 123);
   *
   * const y: Result<number, string> = Result.ok(123);
   * const string = y.match(
   *   (y) => "expected error. but got " + y,
   *   (error) => error
   * );
   *
   * assertEquals(string, "expected error. but got 123");
   *
   * const z: Result<number, string> = Result.err("Some error message");
   * const error = z.match(
   *   (z) => "expected error. but got " + z,
   *   (error) => error
   * );
   *
   * assertEquals(error, "Some error message");
   * ```
   */
  match(ok2, err2) {
    if (this.innerResult.success) {
      return ok2(this.innerResult.value);
    } else {
      return err2(this.innerResult.value);
    }
  }
  async awaited() {
    if (this.innerResult.success) {
      if (this.innerResult.value instanceof Promise) {
        return _Result.ok(await this.innerResult.value);
      } else {
        return _Result.ok(this.innerResult.value);
      }
    } else {
      if (this.innerResult.value instanceof Promise) {
        return _Result.err(await this.innerResult.value);
      } else {
        return _Result.err(this.innerResult.value);
      }
    }
  }
  /**
   * Enables processing as close as possible to Rust's `?` operator.
   * @example
   * ```ts
   * const withResult = (): Result<number, string> => {
   *    return Result.ok(2);
   * };
   *
   * const func = (): Result<number, string> => {
   *   const result = withResult().branch();
   *
   *   if (result.isBreak) return result.value;
   *
   *   return Result.ok(result.value);
   * };
   *
   * func();
   *
   * ```
   */
  branch() {
    return this.match(
      (value) => ({ isBreak: false, value }),
      (_) => ({ isBreak: true, value: this })
    );
  }
};
var ok = Result.ok;
var err = Result.err;

// async_result.ts
var AsyncResult = class _AsyncResult {
  constructor(inner) {
    this.inner = inner;
  }
  static none = Result.none;
  static ok(value) {
    return new _AsyncResult(
      Promise.resolve(
        new Result({
          success: true,
          value
        })
      )
    );
  }
  static err(value) {
    return new _AsyncResult(
      Promise.resolve(
        new Result({
          success: false,
          value
        })
      )
    );
  }
  static fromPromiseResult(promiseResult) {
    if (typeof promiseResult === "function") {
      return new _AsyncResult(promiseResult());
    } else {
      return new _AsyncResult(promiseResult);
    }
  }
  /**
   * Returns `true` if the result is {@linkcode Ok}.
   *
   * @example
   * ```ts
   * import { assertEquals } from "@std/assert";
   *
   * const x: AsyncResult<number, string> = AsyncResult.ok(-3);
   * assertEquals(await x.isOk(), true);
   *
   * const y: AsyncResult<number, string> = AsyncResult.err("Some error message");
   * assertEquals(await y.isOk(), false);
   * ```
   */
  async isOk() {
    return (await this).isOk();
  }
  /**
   * Returns `true` if the result is {@linkcode Ok} and the value inside of it matches a predicate.
   *
   * @example
   * ```ts
   * import { assertEquals } from "@std/assert";
   *
   * const asyncResultU: AsyncResult<number, string> = AsyncResult.ok(2);
   * assertEquals(await asyncResultU.isOkAnd((i) => i > 1), true);
   *
   * const asyncResultV: AsyncResult<number, string> = AsyncResult.ok(2);
   * assertEquals(await asyncResultV.isOkAnd((i) => i < 0), false);
   *
   * const asyncResultW: AsyncResult<number, string> = AsyncResult.err("hey");
   * assertEquals(await asyncResultW.isOkAnd((i) => i > 1), false);
   *
   * // Async function...
   * const asyncResultX: AsyncResult<number, string> = AsyncResult.ok(2);
   * assertEquals(await asyncResultX.isOkAnd(async (i) => i > 1), true);
   *
   * const asyncResultY: AsyncResult<number, string> = AsyncResult.ok(2);
   * assertEquals(await asyncResultY.isOkAnd(async (i) => i < 0), false);
   *
   * const asyncResultZ: AsyncResult<number, string> = AsyncResult.err("hey");
   * assertEquals(await asyncResultZ.isOkAnd(async (i) => i > 1), false);
   * ```
   */
  isOkAnd(f) {
    return this.match(
      (value) => f(value),
      () => false
    );
  }
  /**
   * Returns `true` if the result is {@linkcode Err}.
   *
   * @example
   * ```ts
   * import { assertEquals } from "@std/assert";
   *
   * const x: AsyncResult<number, string> = AsyncResult.ok(-3);
   * assertEquals(await x.isErr(), false);
   *
   * const y: AsyncResult<number, string> = AsyncResult.err("Some error message");
   * assertEquals(await y.isErr(), true);
   * ```
   */
  async isErr() {
    return (await this).isErr();
  }
  /**
   * Returns `true` if the result is {@linkcode Err} and the value inside of it matches a predicate.
   *
   * @example
   * ```ts
   * import { assertEquals } from "jsr:@std/assert@1";
   *
   * const asyncResultU: AsyncResult<number, string> = AsyncResult.err("Some error message");
   * assertEquals(await asyncResultU.isErrAnd((x) => x === "Some error message"), true);
   *
   * const asyncResultV: AsyncResult<number, string> = AsyncResult.err("Another error message");
   * assertEquals(await asyncResultV.isErrAnd((y) => y === "Some error message"), false);
   *
   * const asyncResultW: AsyncResult<number, string> = AsyncResult.ok(123);
   * assertEquals(await asyncResultW.isErrAnd((z) => z === "Some error message"), false);
   *
   * // Async function...
   * const asyncResultX: AsyncResult<number, string> = AsyncResult.err("Some error message");
   * assertEquals(await asyncResultX.isErrAnd(async (x) => x === "Some error message"), true);
   *
   * const asyncResultY: AsyncResult<number, string> = AsyncResult.err("Another error message");
   * assertEquals(await asyncResultY.isErrAnd(async (y) => y === "Some error message"), false);
   *
   * const asyncResultZ: AsyncResult<number, string> = AsyncResult.ok(123);
   * assertEquals(await asyncResultZ.isErrAnd(async (z) => z === "Some error message"), false);
   * ```
   */
  isErrAnd(f) {
    return this.match(
      () => false,
      (err2) => f(err2)
    );
  }
  async ok(noneSymbol) {
    const result = await this;
    if (result.innerResult.success) {
      return result.innerResult.value;
    }
    if (noneSymbol) {
      return _AsyncResult.none;
    } else {
      return null;
    }
  }
  async err(noneSymbol) {
    const result = await this;
    if (!result.innerResult.success) {
      return result.innerResult.value;
    }
    if (noneSymbol) {
      return _AsyncResult.none;
    } else {
      return null;
    }
  }
  /**
   * Maps a Result<T, E> to Result<U, E> by applying a function to a contained Ok value, leaving an Err value untouched.
   * This function can be used to compose the results of two functions.
   *
   * @example
   * ```ts
   * import { assertEquals } from "@std/assert";
   *
   * const x: AsyncResult<number, string> = AsyncResult.ok(100);
   * assertEquals(await x.map((i) => i * 2).unwrap(), 200);
   *
   * const z: AsyncResult<number, string> = AsyncResult.err("Some error message");
   * assertEquals(await z.map((i) => i * 2).unwrapErr(), "Some error message");
   * ```
   */
  map(op) {
    return _AsyncResult.fromPromiseResult(async () => (await this).map(op));
  }
  async mapOr(defaultValue, f) {
    return (await this).mapOr(defaultValue, f);
  }
  async mapOrElse(defaultValue, f) {
    return (await this).mapOrElse(defaultValue, f);
  }
  mapErr(op) {
    return _AsyncResult.fromPromiseResult(async () => (await this).mapErr(op));
  }
  inspect(f) {
    return _AsyncResult.fromPromiseResult(async () => (await this).inspect(f));
  }
  inspectErr(f) {
    return _AsyncResult.fromPromiseResult(
      async () => (await this).inspectErr(f)
    );
  }
  and(res) {
    return _AsyncResult.fromPromiseResult(
      async () => (await this).and(await res)
    );
  }
  andThen(op) {
    return _AsyncResult.fromPromiseResult(
      this.match(
        (value) => op(value),
        () => this
      )
    );
  }
  or(res) {
    return _AsyncResult.fromPromiseResult(
      async () => (await this).or(await res)
    );
  }
  orElse(op) {
    return _AsyncResult.fromPromiseResult(
      this.match(
        () => this,
        (error) => op(error)
      )
    );
  }
  /**
   * Returns the contained {@linkcode Ok} value.
   * Because this function throw {@linkcode Panic}, its use is generally discouraged. Instead, prefer to use {@linkcode Result.prototype.match} and handle the Err case explicitly, or call {@linkcode Result.prototype.unwrapOr}, {@linkcode Result.prototype.unwrapOrElse}.
   *
   * @example
   * ```ts
   * import { assertEquals } from "@std/assert";
   *
   * const x: AsyncResult<number, string> = AsyncResult.ok(2);
   * assertEquals(await x.unwrap(), 2);
   * ```
   *
   * @example
   * ```ts
   * import { assertRejects } from "@std/assert";
   *
   * const x: AsyncResult<number, string> = AsyncResult.err("Some error message");
   * assertRejects(async () => await x.unwrap());
   * ```
   *
   * @throws {Panic} if the value is an {@linkcode Err}, with a panic message provided by the Err’s value.
   */
  async unwrap() {
    return (await this).unwrap();
  }
  async unwrapErr() {
    return (await this).unwrapErr();
  }
  async unwrapOr(defaultValue) {
    return (await this).unwrapOr(defaultValue);
  }
  unwrapOrElse(defaultValue) {
    return this.match(
      (value) => value,
      () => defaultValue()
    );
  }
  async orThrow() {
    return (await this).orThrow();
  }
  /**
   * Methods that can be used similarly to the Match statement, a Rust expression.
   *
   * @example
   * ```ts
   * import { assertEquals } from "@std/assert";
   *
   * const x: AsyncResult<number, string> = AsyncResult.ok(123);
   * const number = await x.match(
   *   (x) => x,
   *   (_) => 0
   * );
   *
   * assertEquals(number, 123);
   *
   * const y: AsyncResult<number, string> = AsyncResult.ok(123);
   * const string = await y.match(
   *   (y) => "expected error. but got " + y,
   *   (error) => error
   * );
   *
   * assertEquals(string, "expected error. but got 123");
   *
   * const z: AsyncResult<number, string> = AsyncResult.err("Some error message");
   * const error = await z.match(
   *   (z) => "expected error. but got " + z,
   *   (error) => error
   * );
   *
   * assertEquals(error, "Some error message");
   * ```
   */
  async match(ok2, err2) {
    return await (await this).match(ok2, err2);
  }
  then(onfulfilled, onrejected) {
    return this.inner.then(onfulfilled, onrejected);
  }
};

// mod.ts
var uriToReadableStream = async (uri) => {
  const resp = await fetch(uri).then(
    (resp2) => Result.ok(resp2),
    (err2) => Result.err(String(err2))
  );
  return resp.andThen((resp2) => {
    const body = resp2.body;
    if (!body) {
      return Result.err("tarball has no body");
    }
    return Result.ok(body);
  });
};
var tarballUriToToFileMap = async (tarUri) => {
  const binaryStreamResult = await uriToReadableStream(tarUri);
  return AsyncResult.fromPromiseResult(
    binaryStreamResult.match(
      async (stream) => {
        const fileMap = /* @__PURE__ */ new Map();
        try {
          const tarStream = stream.pipeThrough(new DecompressionStream("gzip"));
          for await (const entry of entries(tarStream)) {
            const body = new Uint8Array(await new Response(entry.body).arrayBuffer());
            fileMap.set(entry.name, body);
          }
        } catch (err2) {
          return Result.err(String(err2));
        }
        return Result.ok(fileMap);
      },
      // deno-lint-ignore require-await
      async (err2) => Result.err(err2)
    )
  );
};
var getResponse = (filename, fileMap) => {
  const ext = filename.split(".").pop();
  const file = fileMap.get(filename);
  if (!file || !ext) {
    return Result.ok(null);
  }
  const mime = lookup(ext);
  if (!mime) {
    return Result.err("unsupported");
  }
  const { type: mimeType, isUtf8 } = mime;
  const contentType = `${mimeType}${isUtf8 ? "; charset=UTF-8" : ""}`;
  const headers = {
    "Content-Type": contentType,
    "Content-Length": file.byteLength.toString()
  };
  return Result.ok(new Response(file, { headers }));
};

// browser-demo.ts
var { setupWorker, http, bypass } = globalThis.MockServiceWorker;
var createHandlers = async () => {
  const map = (await tarballUriToToFileMap("https://registry.npmjs.org/react/-/react-18.2.0.tgz")).unwrap();
  return [
    http.get("*", async (ctx) => {
      debugger;
      const { params, request } = ctx;
      const responseResult = getResponse(ctx.request.url.pathname, map);
      return responseResult.match(
        (ok2) => {
          if (!ok2) {
            return bypass(request);
          }
          return ok2;
        },
        (err2) => {
          console.warn(err2);
          if (err2 === "unsupported") {
            return bypass(request);
          }
          throw new Error(err2);
        }
      );
    })
  ];
};
var main = async () => {
  debugger;
  const handlers = await createHandlers();
  setupWorker(...handlers);
};
globalThis.gonuts = () => fetch("/package.json").then((res) => res.json()).then(console.log);
main();
export {
  createHandlers
};
