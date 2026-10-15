# One public homepage cloud pilot

Prepared only. No cloud run, browser launch, publication, website change or deployment is established by these files.

The manual-only workflow uses one standard GitHub-hosted Ubuntu 24.04 job, Node 22.19.0, Playwright 1.63.0 and the pinned axe packages 4.13.0. There is no schedule, agent, monitor, caching, retry, profile, customer data, credential input or site source upload.

`targets.json` intentionally contains an empty list. A reviewer must supply exactly one public canonical HTTPS homepage URL and its public identity assertions before dispatch. Example schema using a placeholder public domain:

```json
[
  {
    "url": "https://example.com/",
    "assertions": {
      "titleEquals": "Exact published title",
      "h1Equals": "Exact published heading text",
      "canonicalEquals": "https://example.com/",
      "bodyIncludes": ["Public business identity"],
      "previousHtmlSha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  }
]
```

Exactly one main-document GET is permitted. JavaScript and service workers are disabled. All stylesheets, images, scripts, fonts, iframe documents, API/preview/customer/auth/submit requests and other network requests are blocked; WebSocket connections are closed. No links are clicked, controls changed, forms submitted or page content scripts run. One screenshot is captured at 390x900 without another navigation. A redirect, 429, second main navigation or mutation attempt fails the pilot. The optional prior HTML hash is compared with this same response; drift is reported without another fetch.

The sole upstream GET uses Playwright `route.fetch` with zero redirects and retries, then fulfills that response into Chromium. A redirect is aborted before delivery to Chromium, preventing an automatic second GET. Both cloud execution and public identity assertions must pass for a zero process exit code; their diagnostic axes remain separate.

Screenshots intentionally show incomplete, unstyled public HTML. Readable-text/title/H1 assertions are separate from cloud execution success. Axe is not run in this strict mode; no accessibility, responsive-design, performance, candidate, production-delivery or sustained 45-minute stability pass is claimed. Pinned axe metadata is retained solely for exact toolchain evidence and future separately reviewed work.

Artifacts contain only the reviewed public target URL, sanitized public title/H1 and assertion results, layout diagnostics, one viewport screenshot, curated Linux/GitHub-hosted runtime facts, exact versions, real elapsed duration, one active Chrome descendant RSS event sample and browser/context close results. They omit HTML, raw console strings, request URLs/queries, traces, environment dumps, cookies and secrets. Summed RSS can double count shared memory and does not demonstrate Mac memory savings. API close/disconnect evidence is not a second OS process inventory.

`npm test` is a lightweight built-in Node policy test with no dependencies or browser. `node --check run.mjs` checks syntax without executing imports. The workflow installs dependencies with lifecycle scripts disabled, installs Chromium only on the hosted runner, and uploads only `artifacts/`.

The 15-minute job timeout bounds the run. Artifact retention is configured to one day; this is not an automatic 45-minute public-exposure deadline. The requesting owner must manage any shorter repository/artifact exposure and removal separately. No existing website audit, proposal, owner or release gate is replaced.
