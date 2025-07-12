function logEvent(event, data = {}) {
  console.log(
    `[${new Date().toISOString()}] EVENT: ${event}`,
    JSON.stringify(data)
  );
}
module.exports = logEvent;
