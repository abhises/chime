import ChimeMeetingManager from "./chime/chimeMeetingManager.js";
import dotenv from "dotenv";
dotenv.config();

async function test() {
  try {
    const meeting = await ChimeMeetingManager.createMeeting({
      title: "Team Sync",
      creatorUserId: "user-123",
    });

    console.log("Created meeting:", meeting);

    const added = await ChimeMeetingManager.addAttendee(
      meeting.MeetingId,
      "user-123"
    );
    console.log("Added attendee:", added);

    const result = await ChimeMeetingManager.getMeeting(meeting.MeetingId);
    console.log("Fetched meeting:", result);

    // Show cache statistics
    console.log("\n📊 Cache Statistics:", redisWrapper.getCacheStats());

    console.log("✅ All tests passed!");
  } catch (err) {
    console.error("Test failed:", err.message);
  }
}
