// Test-only stand-in for the `server-only` package. The real package is not installed (Next.js aliases it at
// build time) and only throws when imported from a client bundle. Used solely through NODE_PATH by
// scripts/test-db.mjs; it is never part of the application.
module.exports = {};
