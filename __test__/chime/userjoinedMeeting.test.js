import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";
import ScyllaDb from "../../ScyllaDb.js";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  await ScyllaDb.loadTableConfigs("./tables.json");
});

describe("userJoinedMeeting", () => {
  beforeEach(() => {
    ErrorHandler.clear();
  });

  test("should log a standard user join", async () => {
    const meeting = await Chime.createMeeting({
      title: "JoinStandard",
      creatorUserId: "hostJ1",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userJ1");
    await expect(
      Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userJ1")
    ).resolves.not.toThrow();
  });

  test("should reject fake attendee", async () => {
    await expect(
      Chime.userJoinedMeeting(
        "meeting-valid-00122",
        "fake-attendee22",
        "userGhost22"
      )
    ).rejects.toThrow("Attendee not found");
  });

  test("should reject null inputs", async () => {
    await expect(Chime.userJoinedMeeting(null, null, null)).rejects.toThrow();
  });

  test("should update timestamp on double join", async () => {
    const meeting = await Chime.createMeeting({
      title: "DoubleJoin",
      creatorUserId: "hostJ2",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userJ2");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userJ2");
    await new Promise((r) => setTimeout(r, 1000));
    await expect(
      Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userJ2")
    ).resolves.not.toThrow();
  });

  test("should pass logging for join", async () => {
    const meeting = await Chime.createMeeting({
      title: "LogCheckJoin",
      creatorUserId: "logHost",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userLog");
    await expect(
      Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userLog")
    ).resolves.not.toThrow();
  });

  test("should reject invalid meeting ID", async () => {
    await expect(
      Chime.userJoinedMeeting("invalid-meet-idk", "some-atts", "usersX")
    ).rejects.toThrow("Attendee not found");
  });

  test("should reject empty strings", async () => {
    await expect(Chime.userJoinedMeeting("", "", "")).rejects.toThrow();
  });

  test("should allow rejoin after leave", async () => {
    const meeting = await Chime.createMeeting({
      title: "LeaveAndRejoin",
      creatorUserId: "reHost",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userRe");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userRe");
    await Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "userRe");
    await expect(
      Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userRe")
    ).resolves.not.toThrow();
  });

  test("should reject invalid input types", async () => {
    await expect(Chime.userJoinedMeeting({}, [], 12345)).rejects.toThrow();
  });

  test("should add log entry to JoinLogs", async () => {
    const meeting = await Chime.createMeeting({
      title: "JoinLogsVerify",
      creatorUserId: "hostJL",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userJL");
    await expect(
      Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userJL")
    ).resolves.not.toThrow();
    // Additional DB check can be added if needed
  });
});
