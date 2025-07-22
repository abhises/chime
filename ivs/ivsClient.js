// ivsClient.js
import { IvsClient } from "@aws-sdk/client-ivs";
import ErrorHandler from "../utils/ErrorHandler.js";
import Logger from "../utils/UtilityLogger.js";

let cachedClient = null;

export default function getIvsClient() {
  if (cachedClient) {
    return cachedClient;
  }

  try {
    cachedClient = new IvsClient({
      region: process.env.AWS_REGION || "us-west-2",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID_IVS,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_IVS,
      },
    });

    Logger.writeLog({
      flag: "IVS_CLIENT_INIT",
      action: "initClient",
      data: { region: process.env.AWS_REGION || "us-west-2" },
      message: "Initialized IVS client",
    }); // :contentReference[oaicite:0]{index=0}

    return cachedClient;
  } catch (err) {
    ErrorHandler.add_error(err.message, { method: "getIvsClient" }); // :contentReference[oaicite:1]{index=1}
    Logger.writeLog({
      flag: "IVS_CLIENT_ERROR",
      action: "initClient",
      data: { error: err.message },
      critical: true,
      message: "Failed to initialize IVS client",
    }); // :contentReference[oaicite:2]{index=2}
    throw err;
  }
}
