import * as esbuild from "npm:esbuild";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11.1";
import type { Task, Tasks } from "https://deno.land/x/rad/src/mod.ts";

const format: Task = "deno fmt";

const bundle: Task = {
  async fn({ sh }) {
    // Import the Wasm build on platforms where running subprocesses is not
    // permitted, such as Deno Deploy, or when running without `--allow-run`.
    // import * as esbuild from "https://deno.land/x/esbuild@0.20.2/wasm.js";

    const result = await esbuild.build({
      plugins: [...denoPlugins()],
      entryPoints: ["./browser-demo.ts"],
      outfile: "./public/browser-demo.js",
      bundle: true,
      format: "iife",
    });
    console.log(result);
  },
};

const serve: Task = {
  dependsOn: [bundle],
  async fn({ sh }) {
    await sh(`deno run --allow-net --allow-read jsr:@maks0u/cli-serve --port 3000 ./public`);
  },
};

export const tasks: Tasks = {
  bundle,
  /**
   * make-style tasks!
   */
  serve,
  /**
   * command style tasks
   */
  ...{ format, f: format },
};
