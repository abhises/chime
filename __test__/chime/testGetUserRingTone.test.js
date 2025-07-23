import { jest } from "@jest/globals";
import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";
import ScyllaDb from "../../ScyllaDb.js";

const USER_SETTINGS_TABLE = "MeetingAttendees_UserProfiles";

describe("getUserRingtone", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    await ScyllaDb.loadTableConfigs("./tables.json");
  });

  beforeEach(() => {
    ErrorHandler.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks(); // clean up spies
  });

  test("should return custom ringtone if set", async () => {
    const customRingtone = "classic3";

    jest.spyOn(ScyllaDb, "getItem").mockResolvedValueOnce({
      UserId: "ringUser1",
      Ringtone: customRingtone,
    });

    const tone = await Chime.getUserRingtone("ringUser1");
    expect(tone).toBe(customRingtone);
  });

  test("should return default ringtone if not set", async () => {
    jest.spyOn(ScyllaDb, "getItem").mockResolvedValueOnce({
      UserId: "ringUser2",
    });

    const tone = await Chime.getUserRingtone("ringUser2");
    expect(tone).toBe("default");
  });

  test("should fallback to default if user does not exist", async () => {
    jest.spyOn(ScyllaDb, "getItem").mockResolvedValueOnce(null);

    const tone = await Chime.getUserRingtone("nonexistentUser");
    expect(tone).toBe("default");
  });

  test("should reject null userId", async () => {
    await expect(Chime.getUserRingtone(null)).rejects.toThrow(
      "Missing required parameter: userId"
    );
  });

  test("should reject empty userId", async () => {
    await expect(Chime.getUserRingtone("")).rejects.toThrow(
      "Missing required parameter: userId"
    );
  });

  test("should fallback to default if ringtone is explicitly null", async () => {
    jest.spyOn(ScyllaDb, "getItem").mockResolvedValueOnce({
      UserId: "nullToneUser",
      Ringtone: null,
    });

    const tone = await Chime.getUserRingtone("nullToneUser");
    expect(tone).toBe("default");
  });

  test("should handle long ringtone strings", async () => {
    const longTone = "tone_" + "x".repeat(300);

    jest.spyOn(ScyllaDb, "getItem").mockResolvedValueOnce({
      UserId: "longToneUser",
      Ringtone: longTone,
    });

    const tone = await Chime.getUserRingtone("longToneUser");
    expect(tone).toBe(longTone);
  });

  test("should return consistent ringtone on multiple calls", async () => {
    const consistentTone = "synth";

    jest.spyOn(ScyllaDb, "getItem").mockResolvedValue({
      UserId: "repeatToneUser",
      Ringtone: consistentTone,
    });

    const t1 = await Chime.getUserRingtone("repeatToneUser");
    const t2 = await Chime.getUserRingtone("repeatToneUser");

    expect(t1).toBe(consistentTone);
    expect(t2).toBe(consistentTone);
  });
});
