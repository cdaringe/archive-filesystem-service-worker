# @cdaringe/archive-filesystem-service-worker

Given an archive, serve files from that archive using [msw](https://mswjs.io/).

For example, assume the following tarball:

```sh
# foo.tar.gz
.
├── static-storybook
│   ├── assets.js
│   ├── styles.css
│   └── img.png
└── package.json
```

After installing the service worker in browser,

`GET /static-storybook/assets.js` would resolve the file from the archive.

## usage

```ts
import { createTarballFilesHandler } from "jsr:archive-filesystem-service-worker/msw.ts";
import msw from "msw";

const handler = await createTarballFilesHandler(
  msw,
  "https://path.to/tarball.tgz"
);
const worker = setupWorker(handler);
worker.start();
```
