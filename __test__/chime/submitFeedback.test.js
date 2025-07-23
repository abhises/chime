import Chime from "../../chime/Chime.js";
import ErrorHandler from "../../utils/ErrorHandler.js";
import ScyllaDb from "../../ScyllaDb.js";

describe("submitFeedback", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    await ScyllaDb.loadTableConfigs("./tables.json");
  });

  beforeEach(() => {
    ErrorHandler.clear();
  });

  test("should submit full valid feedback", async () => {
    const meeting = await Chime.createMeeting({
      title: "Feedback Full",
      creatorUserId: "hostF1",
    });

    await expect(
      Chime.submitFeedback({
        meetingId: meeting.MeetingId,
        userId: "user1",
        score: 5,
        feedback: "Great!",
        commentToSession: "Loved it",
        rating: 4.8,
      })
    ).resolves.not.toThrow();
  });

  test("should allow minimal feedback fields", async () => {
    const meeting = await Chime.createMeeting({
      title: "Minimal Feedback",
      creatorUserId: "hostMin",
    });

    await expect(
      Chime.submitFeedback({
        meetingId: meeting.MeetingId,
        userId: "userMin",
        score: 3,
        feedback: "",
        commentToSession: null,
        rating: 2.5,
      })
    ).resolves.not.toThrow();
  });

  test("should reject feedback with invalid meeting ID", async () => {
    await expect(
      Chime.submitFeedback({
        meetingId: "invalid-idss",
        userId: "userXll",
        score: 4,
        feedback: "test",
        commentToSession: "",
        rating: 4,
      })
    ).rejects.toThrow("meetingId not found");
  });

  test("should reject null user ID", async () => {
    const meeting = await Chime.createMeeting({
      title: "Null User",
      creatorUserId: "hostNull",
    });

    await expect(
      Chime.submitFeedback({
        meetingId: meeting.MeetingId,
        userId: null,
        score: 4,
        feedback: "OK",
        commentToSession: "",
        rating: 3.2,
      })
    ).rejects.toThrow("Missing required parameter: userId");
  });

  test("should accept edge case score 0", async () => {
    const meeting = await Chime.createMeeting({
      title: "Edge Score",
      creatorUserId: "hostEdge",
    });

    await expect(
      Chime.submitFeedback({
        meetingId: meeting.MeetingId,
        userId: "userZero",
        score: 0,
        feedback: "Bad",
        commentToSession: "",
        rating: 0,
      })
    ).resolves.not.toThrow();
  });

  test("should reject non-numeric rating", async () => {
    const meeting = await Chime.createMeeting({
      title: "Bad Rating",
      creatorUserId: "hostBad",
    });

    await expect(
      Chime.submitFeedback({
        meetingId: meeting.MeetingId,
        userId: "userBad",
        score: 3,
        feedback: "meh",
        commentToSession: "",
        rating: "five",
      })
    ).rejects.toThrow('Invalid type for "rating". Expected numeric.');
  });

  test("should overwrite previous feedback", async () => {
    const meeting = await Chime.createMeeting({
      title: "Overwrite Case",
      creatorUserId: "hostRepeat",
    });

    await Chime.submitFeedback({
      meetingId: meeting.MeetingId,
      userId: "userOverwrite",
      score: 3,
      feedback: "OK",
      commentToSession: "",
      rating: 3.0,
    });

    await expect(
      Chime.submitFeedback({
        meetingId: meeting.MeetingId,
        userId: "userOverwrite",
        score: 5,
        feedback: "Better",
        commentToSession: "Improved",
        rating: 4.9,
      })
    ).resolves.not.toThrow();
  });

  test("should reject empty string IDs", async () => {
    await expect(
      Chime.submitFeedback({
        meetingId: "",
        userId: "",
        score: 3,
        feedback: "Test",
        commentToSession: "",
        rating: 2.5,
      })
    ).rejects.toThrow("Missing required parameter: meetingId");
  });
});
