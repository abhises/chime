import ChimeMeetingManager from "../chime/chimeMeetingManager.js";
import dotenv from "dotenv";
dotenv.config();

async function testCreateMeeting() {
  console.log("\n==== TEST: createMeeting ====\n");

  // 1. ✅ Basic meeting
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "Basic Audio",
      creatorUserId: "user001",
    });
    console.log("✅ Created:", res.MeetingId);
  } catch (e) {
    console.error("❌ Failed basic meeting:", e.message);
  }

  // 2. ✅ Video meeting with recording
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "Video Call",
      type: "private_video",
      recordingEnabled: true,
      creatorUserId: "user002",
    });
    console.log("✅ Video w/ recording:", res.MeetingId);
  } catch (e) {
    console.error("❌ Failed video:", e.message);
  }

  // 3. ✅ Scheduled with PIN and booking
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "Scheduled",
      creatorUserId: "user003",
      defaultPIN: "4321",
      scheduledAt: new Date().toISOString(),
      linkedBookingId: "book789",
    });
    console.log("✅ Scheduled:", res.MeetingId);
  } catch (e) {
    console.error("❌ Scheduled failed:", e.message);
  }

  // 4. ✅ Group audio
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "Group Audio",
      type: "group_audio",
      creatorUserId: "user004",
    });
    console.log("✅ Group audio:", res.MeetingId);
  } catch (e) {
    console.error("❌ Group audio failed:", e.message);
  }

  // 5. ❌ Missing title
  try {
    const res = await ChimeMeetingManager.createMeeting({
      creatorUserId: "user005",
    });
    console.log("❌ Should fail but passed:", res.MeetingId);
  } catch (e) {
    console.log("✅ Expected fail (no title):", e.message);
  }

  // 6. ❌ Missing creatorUserId
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "No Creator",
    });
    console.log("❌ Should fail but passed:", res.MeetingId);
  } catch (e) {
    console.log("✅ Expected fail (no creatorUserId):", e.message);
  }

  // 7. ✅ Chat disabled
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "No Chat",
      chatEnabled: false,
      creatorUserId: "user006",
    });
    console.log("✅ Chat disabled:", res.MeetingId);
  } catch (e) {
    console.error("❌ Chat disabled failed:", e.message);
  }

  // 8. ❌ Invalid type
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "Bad Type",
      creatorUserId: "user007",
      type: "nonsense_type",
    });
    console.log("✅ Unexpected success (invalid type)", res.MeetingId);
  } catch (e) {
    console.log("✅ Expected fail (invalid type):", e.message);
  }

  // 9. ❌ Simulated AWS SDK failure
  try {
    // Use a bad region or force failure here if needed
    process.env.AWS_REGION = "invalid-region";
    const res = await ChimeMeetingManager.createMeeting({
      title: "AWS fail",
      creatorUserId: "user008",
    });
    console.log("❌ Unexpected success on bad AWS region:", res.MeetingId);
  } catch (e) {
    console.log("✅ Expected AWS region fail:", e.message);
  } finally {
    process.env.AWS_REGION = "us-east-1"; // reset
  }

  // 10. ✅ Full metadata
  try {
    const res = await ChimeMeetingManager.createMeeting({
      title: "Full",
      type: "group_video",
      creatorUserId: "user009",
      defaultPIN: "123456",
      scheduledAt: new Date().toISOString(),
      linkedBookingId: "bookingXYZ",
      chatEnabled: true,
      recordingEnabled: true,
    });
    console.log("✅ Full meta passed:", res.MeetingId);
  } catch (e) {
    console.error("❌ Full meta failed:", e.message);
  }
}

testCreateMeeting();
