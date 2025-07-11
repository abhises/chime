const { IvsClient } = require("@aws-sdk/client-ivs");

let cachedClient = null;

function getIvsClient() {
  if (cachedClient) return cachedClient;

  cachedClient = new IvsClient({
    region: process.env.AWS_REGION || "us-west-2",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID_IVS,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_IVS,
    },
  });

  return cachedClient;
}
module.exports = getIvsClient;
