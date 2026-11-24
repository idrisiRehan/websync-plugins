// Preloaded with --import by the CLI tests: sends every fetch to the local server named in
// LOCAL_LISTS, with the original URL as the path, so no test reaches an operator's site while the
// CLI's own fetch code still runs unchanged.

const base = process.env.LOCAL_LISTS;
const realFetch = globalThis.fetch;
if (base) globalThis.fetch = (input, init) => realFetch(`${base}/${encodeURIComponent(String(input))}`, init);
