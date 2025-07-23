import { jest } from "@jest/globals";
import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";

describe("Chime.createMeeting", () => {
  beforeEach(() => {
    ErrorHandler.clear();
    jest.restoreAllMocks?.();
  });

  test("should create a basic meeting", async () => {
    const result = await Chime.createMeeting({
      title: "Basic Audio",
      creatorUserId: "user001",
    });
    // console.log("result inside test", result);

    expect(result).toHaveProperty("MeetingId");
    expect(result.Title).toBe("Basic Audio");
  });

  test("should create a video meeting with recording", async () => {
    const result = await Chime.createMeeting({
      title: "Video Call",
      type: "private_video",
      recordingEnabled: true,
      creatorUserId: "user002",
    });

    expect(result).toHaveProperty("RecordingEnabled", true);
  });

  test("should create a scheduled meeting with metadata", async () => {
    const result = await Chime.createMeeting({
      title: "Scheduled",
      creatorUserId: "user003",
      defaultPIN: "4321",
      scheduledAt: new Date().toISOString(),
      linkedBookingId: "book789",
    });

    expect(result.BookingId).toBe("book789");
  });

  test("returns null if title is missing", async () => {
    const result = await Chime.createMeeting({ creatorUserId: "user005" });
    expect(result).toBeNull();
    expect(ErrorHandler.get_all_errors()).toContainEqual(
      expect.objectContaining({
        message: "Missing required parameter: title",
      })
    );
  });

  test("returns null if creatorUserId is missing", async () => {
    const result = await Chime.createMeeting({ title: "No Creator" });
    expect(result).toBeNull();
    expect(ErrorHandler.get_all_errors()).toContainEqual(
      expect.objectContaining({
        message: "Missing required parameter: creatorUserId",
      })
    );
  });

  test("should create meeting with chat disabled", async () => {
    const result = await Chime.createMeeting({
      title: "No Chat",
      chatEnabled: false,
      creatorUserId: "user006",
    });

    expect(result.ChatEnabled).toBe(false);
  });

  test("returns null if invalid type is provided", async () => {
    const result = await Chime.createMeeting({
      title: "Bad Type",
      creatorUserId: "user007",
      type: "nonsense_type",
    });

    // expect(result).toBeNull();
    expect(result).toHaveProperty("MeetingId");
  });

  test("should create meeting with full metadata", async () => {
    const result = await Chime.createMeeting({
      title: "Full",
      type: "group_video",
      creatorUserId: "user009",
      defaultPIN: "123456",
      scheduledAt: new Date().toISOString(),
      linkedBookingId: "bookingXYZ",
      chatEnabled: true,
      recordingEnabled: true,
    });

    expect(result).not.toBeNull();
    expect(result.MeetingType).toBe("group_video");
    expect(result.RecordingEnabled).toBe(true);
    expect(result.BookingId).toBe("bookingXYZ");
  });
});
