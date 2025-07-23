import { jest } from "@jest/globals";
import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";
import ScyllaDb from "../../ScyllaDb.js";

const MEETINGS_TABLE = "MeetingMeetings";

describe("hasRecording", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    await ScyllaDb.loadTableConfigs("./tables.json");
  });

  beforeEach(() => {
    ErrorHandler.clear();
  });

  test("should return true when recording URL exists", async () => {
    const meeting = await Chime.createMeeting({
      title: "HasRecordingYes",
      creatorUserId: "hostHR1",
    });

    await ScyllaDb.updateItem(
      MEETINGS_TABLE,
      { MeetingId: meeting.MeetingId },
      { RecordingS3Url: "https://s3.amazonaws.com/recording2.mp4" }
    );

    const hasRecording = await Chime.hasRecording(meeting.MeetingId);
    expect(hasRecording).toBe(true);
  });

  test("should return false when recording URL is not set", async () => {
    const meeting = await Chime.createMeeting({
      title: "HasRecordingNo",
      creatorUserId: "hostHR2",
    });

    const hasRecording = await Chime.hasRecording(meeting.MeetingId);
    expect(hasRecording).toBe(false);
  });

  test("should reject invalid meeting ID", async () => {
    await expect(Chime.hasRecording("invalid-meeting-ids")).rejects.toThrow(
      "meetingId not found"
    );
  });

  test("should reject null meeting ID", async () => {
    await expect(Chime.hasRecording(null)).rejects.toThrow(
      "Missing required parameter: meetingId"
    );
  });
});
