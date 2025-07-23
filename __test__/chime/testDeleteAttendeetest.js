import { jest } from "@jest/globals";
import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";
import ScyllaDb from "../../ScyllaDb.js";
import UtilityLogger from "../../utils/UtilityLogger.js";

beforeAll(async () => {
  await ScyllaDb.loadTableConfigs("./tables.json");
});

describe("Chime.deleteAttendee", () => {
  beforeEach(() => {
    ErrorHandler.clear();
    jest.restoreAllMocks?.();

    // ⛔️ Prevent Slack or S3 logs during tests that send bad input
    jest.spyOn(UtilityLogger, "notifySlack").mockImplementation(() => {});
    jest.spyOn(UtilityLogger, "writeToS3").mockImplementation(() => {});
  });

  test("should delete a valid attendee", async () => {
    const meeting = await Chime.createMeeting({
      title: "DeleteTest",
      creatorUserId: "hostDel",
    });
    const attendee = await Chime.addAttendee(meeting.MeetingId, "userDel1");
    await expect(
      Chime.deleteAttendee(meeting.MeetingId, attendee.AttendeeId)
    ).resolves.not.toThrow();
  });

  test("should reject deletion of non-existent attendee", async () => {
    await expect(
      Chime.deleteAttendee("meeting-valid-001", "non-existent-attendee")
    ).rejects.toThrow();
  });

  test("should reject deletion from non-existent meeting", async () => {
    await expect(
      Chime.deleteAttendee("non-existent-meeting", "fake-id")
    ).rejects.toThrow();
  });

  test("should handle double deletion gracefully", async () => {
    const meeting = await Chime.createMeeting({
      title: "DoubleDelete",
      creatorUserId: "hostDouble",
    });

    const attendee = await Chime.addAttendee(meeting.MeetingId, "userDouble");

    await Chime.deleteAttendee(meeting.MeetingId, attendee.AttendeeId);

    // Second deletion should not throw
    await expect(
      Chime.deleteAttendee(meeting.MeetingId, attendee.AttendeeId)
    ).resolves.toBeUndefined();
  });

  test("should reject deletion with invalid types", async () => {
    await expect(Chime.deleteAttendee(123, 456)).rejects.toThrow();
  });

  test("should allow multiple deletions in sequence", async () => {
    const meeting = await Chime.createMeeting({
      title: "MultiDelete",
      creatorUserId: "hostMulti",
    });
    const userA = await Chime.addAttendee(meeting.MeetingId, "userMultiA");
    const userB = await Chime.addAttendee(meeting.MeetingId, "userMultiB");
    await expect(
      Chime.deleteAttendee(meeting.MeetingId, userA.AttendeeId)
    ).resolves.not.toThrow();
    await expect(
      Chime.deleteAttendee(meeting.MeetingId, userB.AttendeeId)
    ).resolves.not.toThrow();
  });

  test("should reject malformed string input", async () => {
    await expect(Chime.deleteAttendee("@@bad@@", "**bad**")).rejects.toThrow();
  });

  test("should allow re-adding a user after deletion", async () => {
    const meeting = await Chime.createMeeting({
      title: "ReJoiner",
      creatorUserId: "hostRe",
    });
    const att = await Chime.addAttendee(meeting.MeetingId, "userRe");
    await Chime.deleteAttendee(meeting.MeetingId, att.AttendeeId);
    const again = await Chime.addAttendee(meeting.MeetingId, "userRe");
    expect(again).toHaveProperty("AttendeeId");
  });
});
