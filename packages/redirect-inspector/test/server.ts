// A local HTTP server with one route per redirect scenario, shared by the library and CLI
// tests so no external network is involved.

import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

export interface TestServer {
  base: string;
  /** Every request received, in order. */
  requests: IncomingMessage[];
  close: () => void;
}

const REDIRECTS: Record<string, [number, string]> = {
  "/301": [301, "/ok"],
  "/302": [302, "/ok"],
  "/303": [303, "/ok"],
  "/307": [307, "/ok"],
  "/308": [308, "/ok"],
  "/relative": [301, "ok?from=relative"],
  "/dir/dot-relative": [301, "../ok"],
  "/chain": [301, "/301"],
  "/temporary-chain": [302, "/302"],
  "/loop-a": [301, "/loop-b"],
  "/loop-b": [301, "/loop-a"],
  "/self": [301, "/self"],
  "/empty-fragment": [301, "/empty-fragment#"],
  // "/café" as raw UTF-8 bytes: Node writes header strings as Latin-1, one byte per character.
  "/utf8-location": [301, "/cafÃ©"],
  "/to-missing": [301, "/missing"],
  "/to-never": [301, "/never"],
  "/bad-location": [301, "http://bad host/"],
  "/ftp-location": [302, "ftp://example.com/file"],
  "/multiple-choices": [300, "/ok"],
};

export async function startServer(): Promise<TestServer> {
  const requests: IncomingMessage[] = [];
  const server = createServer((req, res) => {
    requests.push(req);
    const path = (req.url ?? "/").split("?")[0];
    const redirect = REDIRECTS[path];
    const countdown = /^\/n\/(\d+)$/.exec(path);
    if (redirect) {
      res.writeHead(redirect[0], { location: redirect[1] });
      res.end();
    } else if (countdown) {
      // /n/3 redirects to /n/2, /n/1, then /n/0 answers 200: n redirects in all.
      const n = Number(countdown[1]);
      res.writeHead(n === 0 ? 200 : 301, n === 0 ? {} : { location: `/n/${n - 1}` });
      res.end();
    } else if (path === "/ok") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    } else if (path === "/no-location") {
      res.writeHead(301);
      res.end();
    } else if (path === "/not-modified") {
      res.writeHead(304);
      res.end();
    } else if (path === "/server-error") {
      res.writeHead(500);
      res.end();
    } else if (path === "/endless") {
      // A body that never ends: the inspector must not wait for it.
      res.writeHead(200, { "content-type": "text/plain" });
      const timer = setInterval(() => res.write("x".repeat(64 * 1024)), 5);
      res.on("close", () => clearInterval(timer));
    } else if (path === "/get-only") {
      res.writeHead(req.method === "HEAD" ? 405 : 200);
      res.end();
    } else if (path === "/never") {
      // Never answers, to test timeouts.
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
