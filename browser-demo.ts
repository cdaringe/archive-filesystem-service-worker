import * as mod from "./mod.ts";

const { setupWorker, http, bypass } = (globalThis as any).MockServiceWorker;

export const createHandlers = async () => {
  const map = (await mod.tarballUriToToFileMap("https://registry.npmjs.org/react/-/react-18.2.0.tgz")).unwrap();

  return [
    http.get("*", async (ctx: any) => {
      debugger;
      const { params, request } = ctx;
      const responseResult = mod.getResponse(ctx.request.url.pathname, map);
      return responseResult.match(
        (ok) => {
          if (!ok) {
            return bypass(request);
          }
          return ok;
        },
        (err) => {
          console.warn(err);
          if (err === "unsupported") {
            return bypass(request);
          }
          throw new Error(err);
        }
      );
    }),
  ];
};

const main = async () => {
  debugger; // eslint-disable-line
  const handlers = await createHandlers();
  setupWorker(...handlers);
};

(globalThis as any).gonuts = () =>
  fetch("/package.json")
    .then((res) => res.json())
    .then(console.log);

main();
