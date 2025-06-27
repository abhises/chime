import ScyllaDb from "./ScyllaDb.js"; // adjust path if needed

async function testGetItem() {
  try {
    const result = await ScyllaDb.getItem("MeetingMeetings", {
      MeetingId: "1234-5678",
    });
    console.log("Item:", result);
  } catch (err) {
    console.error("Test failed:", err.message);
  }
}

testGetItem();
