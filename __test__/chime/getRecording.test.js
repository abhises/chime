import { jest } from "@jest/globals";
import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";
import ScyllaDb from "../../ScyllaDb.js";

const MEETINGS_TABLE = "MeetingMeetings";

describe("getRecording", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    await ScyllaDb.loadTableConfigs("./tables.json");
  });

  beforeEach(() => {
    ErrorHandler.clear();
  });

  test("should return valid recording URL", async () => {
    const meeting = await Chime.createMeeting({
      title: "Recording Enabled",
      creatorUserId: "hostR1",
    });

    await ScyllaDb.updateItem(
      MEETINGS_TABLE,
      { MeetingId: meeting.MeetingId },
      { RecordingS3Url: "https://s3.amazonaws.com/recording1.mp4" }
    );

    const url = await Chime.getRecording(meeting.MeetingId);
    expect(url).toBe("https://s3.amazonaws.com/recording1.mp4");
  });

  test("should return null when recording URL is not set", async () => {
    const meeting = await Chime.createMeeting({
      title: "No Recording",
      creatorUserId: "hostR2",
    });

    const url = await Chime.getRecording(meeting.MeetingId);
    expect(url).toBeNull();
  });

  test("should reject invalid meeting ID", async () => {
    jest.spyOn(Chime, "getMeeting").mockResolvedValueOnce(null);
    await expect(Chime.getRecording("invalid-meeting-id")).rejects.toThrow(
      "meetingId not found"
    );
  });

  test("should reject null meeting ID", async () => {
    await expect(Chime.getRecording(null)).rejects.toThrow(
      "Missing required parameter: meetingId"
    );
  });
});
