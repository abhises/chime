import { jest } from "@jest/globals";
import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";
import ScyllaDb from "../../ScyllaDb.js";

let createdMeeting;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  await ScyllaDb.loadTableConfigs("./tables.json");

  // Create a meeting to reuse for tests
  createdMeeting = await Chime.createMeeting({
    title: "Seed Meeting",
    creatorUserId: "user-seed",
  });
});

describe("Chime.canJoinMeeting", () => {
  beforeEach(() => {
    ErrorHandler.clear();
    jest.restoreAllMocks?.();
  });

  test("should allow joining for a valid user", async () => {
    const result = await Chime.canJoinMeeting(
      createdMeeting.MeetingId,
      "userA"
    );
    expect(result).toBe(true);
  });

  test("should throw error if meeting does not exist", async () => {
    await expect(
      Chime.canJoinMeeting("non-existent-meeting", "userX")
    ).rejects.toThrow("Meeting does not exist");
  });
  test("should reject blocked user", async () => {
    const meetingId = "mock-blocked-meeting";
    const userId = "blocked-user";

    jest.spyOn(Chime, "getMeeting").mockResolvedValue({
      MeetingId: meetingId,
      BlockedAttendeeIds: [userId],
    });

    await expect(Chime.canJoinMeeting(meetingId, userId)).rejects.toThrow(
      "Permission Denied – user blocked from joining"
    );
  });

  test("should reject user who already joined", async () => {
    const meeting = await Chime.createMeeting({
      title: "Join Twice",
      creatorUserId: "creator01",
    });
    await Chime.addAttendee(meeting.MeetingId, "userDup");
    await expect(
      Chime.canJoinMeeting(meeting.MeetingId, "userDup")
    ).rejects.toThrow("User already joined");
  });

  test("should deny over attendee limit", async () => {
    const meeting = await Chime.createMeeting({
      title: "Overload",
      creatorUserId: "creator02",
    });

    for (let i = 0; i < 25; i++) {
      await Chime.addAttendee(meeting.MeetingId, `auto-user-${i}`);
    }

    const result = await Chime.canJoinMeeting(meeting.MeetingId, "late-user");
    expect(result).toBe(true);
  }, 20000); // Extended timeout

  test("should throw error for null meetingId", async () => {
    await expect(Chime.canJoinMeeting(null, "userX")).rejects.toThrow(
      "Missing required parameter"
    );
  });

  test("should throw error for empty userId", async () => {
    await expect(
      Chime.canJoinMeeting(createdMeeting.MeetingId, "")
    ).rejects.toThrow("Missing required parameter");
  });

  test("should allow fresh user to join", async () => {
    const meeting = await Chime.createMeeting({
      title: "Fresh Join",
      creatorUserId: "hostX",
    });
    const allowed = await Chime.canJoinMeeting(meeting.MeetingId, "freshUser");
    expect(allowed).toBe(true);
  });

  test("should handle malformed IDs", async () => {
    await expect(Chime.canJoinMeeting("$$$", "@@@@")).rejects.toThrow();
  });

  test("should handle number input for userId", async () => {
    await expect(
      Chime.canJoinMeeting(createdMeeting.MeetingId, 123456)
    ).rejects.toThrow();
  });
});
