// Loaded only by creddy:test, including every node:test child process. Tests
// must inject their network clients; sourced production credentials never turn
// fake publication fixtures into external requests.
globalThis.fetch = async () => {
  throw new Error('Unmocked network request blocked by the Creddy test harness');
};
