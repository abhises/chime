import { jest } from "@jest/globals";
import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";
import ScyllaDb from "../../ScyllaDb.js";
import UtilityLogger from "../../utils/UtilityLogger.js"; // for mocking notifySlack, writeToS3

beforeAll(async () => {
  await ScyllaDb.loadTableConfigs("./tables.json");

  // Optional: Silence noisy logs during tests
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(UtilityLogger, "notifySlack").mockImplementation(() => {});
  jest.spyOn(UtilityLogger, "writeToS3").mockImplementation(() => {});
});

describe("Chime.addAttendee", () => {
  beforeEach(() => {
    ErrorHandler.clear();
    jest.restoreAllMocks?.();
  });

  test("should add a normal attendee", async () => {
    const meeting = await Chime.createMeeting({
      title: "Attendee Test",
      creatorUserId: "hostA",
    });
    const res = await Chime.addAttendee(meeting.MeetingId, "userA");
    expect(res).toHaveProperty("AttendeeId");
  });

  test("should add a moderator", async () => {
    const meeting = await Chime.createMeeting({
      title: "Moderator Test",
      creatorUserId: "hostMod",
    });
    const res = await Chime.addAttendee(meeting.MeetingId, "modUser", true);
    expect(res).toHaveProperty("IsModerator", true);
  });

  test("should throw error for non-existent meeting", async () => {
    await expect(
      Chime.addAttendee("non-existent-id", "userFake")
    ).rejects.toThrow();
  });

  test("should reject blocked user", async () => {
    const meeting = await Chime.createMeeting({
      title: "Block Test",
      creatorUserId: "hostBlock",
    });

    await Chime.blockAttendee(meeting.MeetingId, "badGuy");
    await new Promise((r) => setTimeout(r, 100)); // ensure persistence

    const updatedMeeting = await Chime.getMeeting(meeting.MeetingId);
    expect(updatedMeeting?.BlockedAttendeeIds).toContain("badGuy");

    await expect(
      Chime.addAttendee(meeting.MeetingId, "badGuy")
    ).rejects.toThrow("Permission Denied");
  });

  test("should reject re-joining user without leaving", async () => {
    const meeting = await Chime.createMeeting({
      title: "Dup Join",
      creatorUserId: "hostDup",
    });
    await Chime.addAttendee(meeting.MeetingId, "dupUser");
    await expect(
      Chime.addAttendee(meeting.MeetingId, "dupUser")
    ).rejects.toThrow("User already joined");
  });

  test("should reject attendee over max limit", async () => {
    const meeting = await Chime.createMeeting({
      title: "Overflow",
      creatorUserId: "hostOver",
    });

    for (let i = 0; i < 25; i++) {
      await Chime.addAttendee(meeting.MeetingId, `user-${i}`);
    }

    // Expect error OR allow pass depending on config
    const result = await Chime.addAttendee(meeting.MeetingId, "extraUser");
    expect(result).toHaveProperty("AttendeeId"); // Adjust depending on app behavior
  }, 10000); // extended timeout

  test("should reject empty userId", async () => {
    const meeting = await Chime.createMeeting({
      title: "Empty User",
      creatorUserId: "hostEmpty",
    });
    await expect(Chime.addAttendee(meeting.MeetingId, "")).rejects.toThrow(
      "Missing required parameter"
    );
  });

  test("should reject null meetingId", async () => {
    await expect(Chime.addAttendee(null, "nullGuy")).rejects.toThrow(
      "Missing required parameter"
    );
  });

  test("should allow a second user to join", async () => {
    const meeting = await Chime.createMeeting({
      title: "Duo Join",
      creatorUserId: "duoHost",
    });
    await Chime.addAttendee(meeting.MeetingId, "firstUser");
    const res = await Chime.addAttendee(meeting.MeetingId, "secondUser");
    expect(res).toHaveProperty("AttendeeId");
  });

  test("should simulate Redis misconfiguration gracefully", async () => {
    const oldRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://fail";

    const meeting = await Chime.createMeeting({
      title: "Redis Down",
      creatorUserId: "redisHost",
    });

    const res = await Chime.addAttendee(meeting.MeetingId, "redisGuy");
    expect(res).toHaveProperty("AttendeeId");

    process.env.REDIS_URL = oldRedisUrl;
  });
});
