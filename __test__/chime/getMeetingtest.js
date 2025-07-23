// __test__/chime/getMeeting.test.js
import { jest } from "@jest/globals";
import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";

describe("Chime.getMeeting", () => {
  beforeEach(() => {
    ErrorHandler.clear();
    jest.restoreAllMocks?.();
  });

  test("should return meeting from DB", async () => {
    const result = await Chime.getMeeting(
      "405d2c2f-66cc-45b8-be09-b40f21ab2713"
    );
    expect(result).toHaveProperty("MeetingId");
  });

  test("should return null for non-existent meeting", async () => {
    const result = await Chime.getMeeting("not-a-real-id");
    expect(result).toBe(false);
  });

  test("should return null and log error for empty string input", async () => {
    const result = await Chime.getMeeting("");
    expect(result).toBeNull();
    expect(ErrorHandler.get_all_errors()).toContainEqual(
      expect.objectContaining({
        message: "Missing required parameter: meetingId",
      })
    );
  });

  test("should return null and log error for null input", async () => {
    const result = await Chime.getMeeting(null);
    expect(result).toBeNull();
    expect(ErrorHandler.get_all_errors()).toContainEqual(
      expect.objectContaining({
        message: "Missing required parameter: meetingId",
      })
    );
  });

  test("should handle malformed input gracefully", async () => {
    const result = await Chime.getMeeting("#$%^&*!");
    expect(result).toBe(false);
  });

  test("should handle number input gracefully", async () => {
    const result = await Chime.getMeeting(123456);
    expect(result).toBeNull();
  });

  test("should return created meeting when fetched", async () => {
    const created = await Chime.createMeeting({
      title: "Temp Fetch Test",
      creatorUserId: "user-fetch",
    });

    const fetched = await Chime.getMeeting(created.MeetingId);
    expect(fetched?.MeetingId).toBe(created.MeetingId);
  });
});
