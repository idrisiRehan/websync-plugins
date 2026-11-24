// A store on a local HTTP server, so no test touches the external network. Routes are a table
// of path (with query) -> response; every request is recorded.

import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Route = { status?: number; headers?: Record<string, string>; body?: string } | ((req: IncomingMessage, res: ServerResponse) => void);

export interface Store {
  base: string;
  routes: Record<string, Route>;
  requests: { url: string; headers: IncomingHttpHeaders }[];
  /** The most requests that were open at the same time. */
  readonly maxOpen: number;
  close: () => void;
}

export async function startStore(routes: Record<string, Route> = {}): Promise<Store> {
  const requests: Store["requests"] = [];
  let open = 0;
  let maxOpen = 0;
  const server = createServer((req, res) => {
    requests.push({ url: req.url ?? "/", headers: req.headers });
    open++;
    maxOpen = Math.max(maxOpen, open);
    res.on("close", () => open--);
    const route = routes[req.url ?? "/"];
    if (typeof route === "function") return route(req, res);
    const { status = 200, headers = { "content-type": "text/html; charset=utf-8" }, body = "" } = route ?? { status: 404, body: "<h1>Not found</h1>" };
    // A short delay, so concurrent requests overlap.
    setTimeout(() => {
      res.writeHead(status, headers);
      res.end(body);
    }, 5);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    routes,
    requests,
    get maxOpen() {
      return maxOpen;
    },
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

export const redirect = (location: string, status = 301): Route => ({ status, headers: { location }, body: "" });

/** A body that never ends, to test the byte cap. */
export const endless: Route = (_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  const timer = setInterval(() => res.write("x".repeat(64 * 1024)), 1);
  res.on("close", () => clearInterval(timer));
};

/** Never answers, to test timeouts. */
export const silent: Route = () => {};
