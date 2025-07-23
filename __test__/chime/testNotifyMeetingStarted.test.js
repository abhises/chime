import Chime from "../../chime/Chime.js";

describe("notifyMeetingStarted", () => {
  test("should log without error for valid meetingId", async () => {
    const meeting = await Chime.createMeeting({
      title: "Notify Start",
      creatorUserId: "hostNotif1",
    });

    await expect(
      Chime.notifyMeetingStarted(meeting.MeetingId)
    ).resolves.not.toThrow();
  });

  test("should not throw for nonexistent meeting ID", async () => {
    await expect(
      Chime.notifyMeetingStarted("nonexistent-id")
    ).resolves.not.toThrow();
  });

  test("should not throw for null meetingId", async () => {
    await expect(Chime.notifyMeetingStarted(null)).resolves.not.toThrow();
  });

  test("should not throw for empty meetingId", async () => {
    await expect(Chime.notifyMeetingStarted("")).resolves.not.toThrow();
  });

  test("should allow multiple calls with same ID", async () => {
    const meeting = await Chime.createMeeting({
      title: "Notify Repeat",
      creatorUserId: "hostNotif2",
    });

    await expect(
      Chime.notifyMeetingStarted(meeting.MeetingId)
    ).resolves.not.toThrow();

    await expect(
      Chime.notifyMeetingStarted(meeting.MeetingId)
    ).resolves.not.toThrow();
  });

  test("should log promptly (simulated timestamp check)", async () => {
    const meeting = await Chime.createMeeting({
      title: "Notify Timestamp",
      creatorUserId: "hostNotif3",
    });

    const start = Date.now();
    await expect(
      Chime.notifyMeetingStarted(meeting.MeetingId)
    ).resolves.not.toThrow();
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(200); // arbitrary fast threshold
  });

  test("should accept stringified numeric meeting ID", async () => {
    await expect(Chime.notifyMeetingStarted("12345")).resolves.not.toThrow();
  });

  test("should accept non-string ID without throwing (needs validation?)", async () => {
    await expect(Chime.notifyMeetingStarted(12345)).resolves.not.toThrow();
  });

  test("should handle special character IDs", async () => {
    await expect(
      Chime.notifyMeetingStarted("💥-weird-id-🚀")
    ).resolves.not.toThrow();
  });

  test("should be resilient with arbitrary string ID", async () => {
    await expect(Chime.notifyMeetingStarted("whatever")).resolves.not.toThrow();
  });
});
