import ChimeMeetingManager from "./chime/chimeMeetingManager.js";
import ScyllaDb from "./ScyllaDb.js";
import dotenv from "dotenv";
dotenv.config();

async function test() {
  try {
    console.log("Loading table configurations...");
    await ScyllaDb.loadTableConfigs("./tables.json");
    console.log("✅ Table configurations loaded successfully");

    console.log("Testing ChimeMeetingManager...");
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
  } catch (err) {
    console.error("Test failed:", err.message);
  }
}

test();
