import { jest } from "@jest/globals"; // ✅ Required for ESM
import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";
import ScyllaDb from "../../ScyllaDb.js";

describe("updateRevenue", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    await ScyllaDb.loadTableConfigs("./tables.json");
  });

  beforeEach(() => {
    ErrorHandler.clear();
  });

  test("should add a basic revenue entry", async () => {
    const meeting = await Chime.createMeeting({
      title: "Test Revenue",
      creatorUserId: "revenueHost",
    });

    await expect(
      Chime.updateRevenue(meeting.MeetingId, {
        type: "tip",
        amount: 5,
        tokens: 50,
        source: "booking",
      })
    ).resolves.not.toThrow();
  });

  test("should reject invalid meeting ID", async () => {
    jest.spyOn(Chime, "getMeeting").mockResolvedValueOnce(null); // simulate not found
    await expect(
      Chime.updateRevenue("invalid-meeting-idoo-1", {
        type: "tip",
        amount: 1,
        tokens: 10,
        source: "test",
      })
    ).rejects.toThrow("meetingId not found");
  });

  test("should reject null revenue entry", async () => {
    const meeting = await Chime.createMeeting({
      title: "Null Revenue",
      creatorUserId: "revenueHost2",
    });

    await expect(Chime.updateRevenue(meeting.MeetingId, null)).rejects.toThrow(
      "Missing required parameter: revenueEntry"
    );
  });

  test("should allow $0 revenue", async () => {
    const meeting = await Chime.createMeeting({
      title: "Zero Revenue",
      creatorUserId: "revenueHost3",
    });

    await expect(
      Chime.updateRevenue(meeting.MeetingId, {
        type: "tip",
        amount: 0,
        tokens: 0,
        source: "free",
      })
    ).resolves.not.toThrow();
  });

  test("should allow multiple revenue entries", async () => {
    const meeting = await Chime.createMeeting({
      title: "Multiple Revenue",
      creatorUserId: "revenueHost4",
    });

    const entries = [
      { type: "tip", amount: 10, tokens: 100, source: "bonus" },
      { type: "chat", amount: 5, tokens: 50, source: "chatSession" },
    ];

    for (const entry of entries) {
      await expect(
        Chime.updateRevenue(meeting.MeetingId, entry)
      ).resolves.not.toThrow();
    }
  });

  test("should reject malformed revenue object", async () => {
    const meeting = await Chime.createMeeting({
      title: "Bad Revenue",
      creatorUserId: "revenueHost5",
    });

    await expect(
      Chime.updateRevenue(meeting.MeetingId, {
        amount: 10,
      })
    ).rejects.toThrow("Invalid revenueEntry properties");
  });

  test("should reject empty meeting ID", async () => {
    await expect(
      Chime.updateRevenue("", {
        type: "tip",
        amount: 1,
        tokens: 10,
        source: "misc",
      })
    ).rejects.toThrow("Missing required parameter: meetingId");
  });

  test("should allow high-value revenue", async () => {
    const meeting = await Chime.createMeeting({
      title: "Big Revenue",
      creatorUserId: "revenueHost6",
    });

    await expect(
      Chime.updateRevenue(meeting.MeetingId, {
        type: "tip",
        amount: 1000,
        tokens: 10000,
        source: "vip",
      })
    ).resolves.not.toThrow();
  });
});
