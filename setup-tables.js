import ScyllaDb from "./ScyllaDb.js";
import dotenv from "dotenv";

dotenv.config();

// Configure ScyllaDB client
ScyllaDb.configure({
  endpoint: process.env.SCYLLA_ALTERNATOR_ENDPOINT || "http://localhost:8000/",
  port: process.env.SCYLLA_PORT || 8000,
  region: process.env.SCYLLA_ACCESS_REGION || "us-east-1",
  key: process.env.SCYLLA_ACCESS_KEY || "test",
  secret: process.env.SCYLLA_ACCESS_PASSWORD || "test",
});

async function createTables() {
  try {
    console.log("Creating required tables for Chime Meeting Manager...");

    // Create MeetingMeetings table
    const meetingsTable = {
      TableName: "MeetingMeetings",
      KeySchema: [{ AttributeName: "MeetingId", KeyType: "HASH" }],
      AttributeDefinitions: [
        { AttributeName: "MeetingId", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    };

    await ScyllaDb.createTable(meetingsTable);
    console.log("✅ MeetingMeetings table created");

    // Create MeetingAttendees table
    const attendeesTable = {
      TableName: "MeetingAttendees",
      KeySchema: [
        { AttributeName: "MeetingId", KeyType: "HASH" },
        { AttributeName: "AttendeeId", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "MeetingId", AttributeType: "S" },
        { AttributeName: "AttendeeId", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    };

    await ScyllaDb.createTable(attendeesTable);
    console.log("✅ MeetingAttendees table created");

    // Create MeetingFeedback table
    const feedbackTable = {
      TableName: "MeetingFeedback",
      KeySchema: [
        { AttributeName: "MeetingId", KeyType: "HASH" },
        { AttributeName: "UserId", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "MeetingId", AttributeType: "S" },
        { AttributeName: "UserId", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    };

    await ScyllaDb.createTable(feedbackTable);
    console.log("✅ MeetingFeedback table created");

    // Create MeetingJoinLogs table
    const joinLogsTable = {
      TableName: "MeetingJoinLogs",
      KeySchema: [
        { AttributeName: "UserId", KeyType: "HASH" },
        { AttributeName: "JoinTimestamp", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "UserId", AttributeType: "S" },
        { AttributeName: "JoinTimestamp", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    };

    await ScyllaDb.createTable(joinLogsTable);
    console.log("✅ MeetingJoinLogs table created");

    // Create UserSettings table
    const userSettingsTable = {
      TableName: "UserSettings",
      KeySchema: [{ AttributeName: "UserId", KeyType: "HASH" }],
      AttributeDefinitions: [{ AttributeName: "UserId", AttributeType: "S" }],
      BillingMode: "PAY_PER_REQUEST",
    };

    await ScyllaDb.createTable(userSettingsTable);
    console.log("✅ UserSettings table created");

    console.log("🎉 All tables created successfully!");
  } catch (error) {
    console.error("❌ Error creating tables:", error.message);
    if (error.message.includes("Table already exists")) {
      console.log("ℹ️ Some tables already exist, which is fine.");
    }
  }
}

createTables();
