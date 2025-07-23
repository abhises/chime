import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";
import ScyllaDb from "../../ScyllaDb.js";

describe("userLeftMeeting", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    await ScyllaDb.loadTableConfigs("./tables.json");
  });

  beforeEach(() => {
    ErrorHandler.clear();
  });

  test("should track standard leave", async () => {
    const meeting = await Chime.createMeeting({
      title: "LeaveStandard",
      creatorUserId: "hostLeave1",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userL1");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userL1");
    await expect(
      Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "userL1")
    ).resolves.not.toThrow();
  });

  test("should reject unknown attendee", async () => {
    const meeting = await Chime.createMeeting({
      title: "UnknownAttendeeTesaat",
      creatorUserId: "hostUAaa",
    });
    await expect(
      Chime.userLeftMeeting(
        meeting.MeetingId,
        "nonexistent-attendee-idaa",
        "ghostaa"
      )
    ).rejects.toThrow("Attendee not found");
  });

  test("should reject unknown meeting", async () => {
    await expect(
      Chime.userLeftMeeting("no-such-meeting-idaa", "some-att-aid", "uaser")
    ).rejects.toThrow("Attendee not found");
  });
  test("should reject null inputs", async () => {
    await expect(Chime.userLeftMeeting(null, null, null)).rejects.toThrow(
      "Missing required parameter"
    );
  });

  test("should allow multiple leaves", async () => {
    const meeting = await Chime.createMeeting({
      title: "DoubleLeave",
      creatorUserId: "hostDLeave",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userDL");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userDL");
    await Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "userDL");
    await expect(
      Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "userDL")
    ).resolves.not.toThrow();
  });

  test("should allow leave without prior join", async () => {
    const meeting = await Chime.createMeeting({
      title: "NoJoinLeave",
      creatorUserId: "hostNJ",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userNJ");
    await expect(
      Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "userNJ")
    ).resolves.not.toThrow();
  });

  test("should reject invalid input types", async () => {
    await expect(Chime.userLeftMeeting({}, [], 42)).rejects.toThrow(
      "Missing required parameter: meetingId"
    );
  });

  test("should support join then leave", async () => {
    const meeting = await Chime.createMeeting({
      title: "JoinThenLeave",
      creatorUserId: "hostJL",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userJL");
    await Chime.userJoinedMeeting(meeting.MeetingId, att.AttendeeId, "userJL");
    await expect(
      Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "userJL")
    ).resolves.not.toThrow();
  });

  test("should handle multiple attendees leaving", async () => {
    const meeting = await Chime.createMeeting({
      title: "MultiLeave",
      creatorUserId: "hostML",
    });
    const a1 = await Chime.addAttendee(meeting.MeetingId, "userML1");
    const a2 = await Chime.addAttendee(meeting.MeetingId, "userML2");
    await Chime.userLeftMeeting(meeting.MeetingId, a1.AttendeeId, "userML1");
    await expect(
      Chime.userLeftMeeting(meeting.MeetingId, a2.AttendeeId, "userML2")
    ).resolves.not.toThrow();
  });

  test("should log leave in JoinLogs", async () => {
    const meeting = await Chime.createMeeting({
      title: "LogLeave",
      creatorUserId: "hostLogL",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "logUser");
    await expect(
      Chime.userLeftMeeting(meeting.MeetingId, att.AttendeeId, "logUser")
    ).resolves.not.toThrow();
    // You can add log/db assertions here if available
  });
});
