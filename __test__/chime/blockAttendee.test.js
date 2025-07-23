import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";

describe("blockAttendee", () => {
  beforeEach(() => {
    ErrorHandler.clear();
  });

  test("should block a user successfully", async () => {
    const meeting = await Chime.createMeeting({
      title: "Block Test",
      creatorUserId: "host1",
    });
    await expect(
      Chime.blockAttendee(meeting.MeetingId, "userA")
    ).resolves.not.toThrow();
  });

  test("should prevent blocked user from joining", async () => {
    const meeting = await Chime.createMeeting({
      title: "Block Join Test",
      creatorUserId: "host2",
    });
    await Chime.blockAttendee(meeting.MeetingId, "blockedUser");
    const allowed = await Chime.canJoinMeeting(
      meeting.MeetingId,
      "blockedUser"
    );
    expect(allowed).toBe(false);
  });

  test("should allow idempotent blocking (block twice)", async () => {
    const meeting = await Chime.createMeeting({
      title: "Repeat Block Test",
      creatorUserId: "host3",
    });
    await Chime.blockAttendee(meeting.MeetingId, "repeatUser");
    await expect(
      Chime.blockAttendee(meeting.MeetingId, "repeatUser")
    ).resolves.not.toThrow();
  });

  test("should throw if meeting does not exist", async () => {
    await expect(
      Chime.blockAttendee("nonexistent-meeting-id", "ghostUser")
    ).rejects.toThrow("Meeting not found");
  });

  test("should throw if meetingId is null", async () => {
    await expect(Chime.blockAttendee(null, "user")).rejects.toThrow(
      "Missing required parameter: meetingId"
    );
  });

  test("should throw if userId is null", async () => {
    const meeting = await Chime.createMeeting({
      title: "Null User Test",
      creatorUserId: "host4",
    });
    await expect(Chime.blockAttendee(meeting.MeetingId, null)).rejects.toThrow(
      "Missing required parameter: userId"
    );
  });

  test("should include blocked user in meeting record", async () => {
    const meeting = await Chime.createMeeting({
      title: "Block List Check",
      creatorUserId: "host5",
    });
    await Chime.blockAttendee(meeting.MeetingId, "blockLogUser");
    const updated = await Chime.getMeeting(meeting.MeetingId);
    expect(updated.BlockedAttendeeIds).toContain("blockLogUser");
  });

  test("should block a user after they have left", async () => {
    const meeting = await Chime.createMeeting({
      title: "Post Leave Block",
      creatorUserId: "host6",
    });
    const attendee = await Chime.addAttendee(meeting.MeetingId, "userToLeave");
    await Chime.userLeftMeeting(
      meeting.MeetingId,
      attendee.AttendeeId,
      "userToLeave"
    );
    await expect(
      Chime.blockAttendee(meeting.MeetingId, "userToLeave")
    ).resolves.not.toThrow();
  });

  test("should enforce block via canJoinMeeting", async () => {
    const meeting = await Chime.createMeeting({
      title: "CanJoin After Block",
      creatorUserId: "host7",
    });
    await Chime.blockAttendee(meeting.MeetingId, "testBlockUser");
    const allowed = await Chime.canJoinMeeting(
      meeting.MeetingId,
      "testBlockUser"
    );
    expect(allowed).toBe(false);
  });
});
