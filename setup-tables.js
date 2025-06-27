import ScyllaDb from "./ScyllaDb.js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

/**
 * Setup tables script - Creates all tables defined in tables.json
 */
async function setupTables() {
  try {
    console.log("🚀 Starting table setup process...");

    // Load table configurations
    console.log("📖 Loading table configurations...");
    await ScyllaDb.loadTableConfigs("./tables.json");

    // Read the tables.json file to get table definitions
    const tablesConfig = JSON.parse(fs.readFileSync("./tables.json", "utf8"));

    // Get existing tables
    console.log("🔍 Checking existing tables...");
    const existingTables = await ScyllaDb.listTables();
    const existingTableNames = existingTables.TableNames || [];

    console.log(
      `📋 Found ${existingTableNames.length} existing tables:`,
      existingTableNames
    );

    // Create each table defined in the config
    for (const [tableName, config] of Object.entries(tablesConfig)) {
      console.log(`\n🏗️  Processing table: ${tableName}`);

      if (existingTableNames.includes(tableName)) {
        console.log(`✅ Table '${tableName}' already exists, skipping...`);
        continue;
      }

      try {
        // Create table schema for ScyllaDB
        const tableSchema = {
          TableName: tableName,
          KeySchema: [
            {
              AttributeName: config.PK,
              KeyType: "HASH",
            },
          ],
          AttributeDefinitions: [
            {
              AttributeName: config.PK,
              AttributeType: "S",
            },
          ],
          BillingMode: "PAY_PER_REQUEST",
        };

        // Add sort key if defined
        if (config.SK) {
          tableSchema.KeySchema.push({
            AttributeName: config.SK,
            KeyType: "RANGE",
          });
          tableSchema.AttributeDefinitions.push({
            AttributeName: config.SK,
            AttributeType: "S",
          });
        }

        console.log(`📝 Creating table schema for '${tableName}'...`);
        console.log(`   - Primary Key: ${config.PK}`);
        if (config.SK) {
          console.log(`   - Sort Key: ${config.SK}`);
        }
        console.log(`   - Columns: ${Object.keys(config.columns).length}`);

        // Create the table
        const result = await ScyllaDb.createTable(tableSchema);
        console.log(`✅ Table '${tableName}' created successfully!`);

        // Wait a moment for table to be ready
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(
          `❌ Failed to create table '${tableName}':`,
          error.message
        );

        // Log detailed error for debugging
        if (error.httpStatus) {
          console.error(`   HTTP Status: ${error.httpStatus}`);
          console.error(`   AWS Error Type: ${error.awsType}`);
          console.error(`   AWS Error Message: ${error.awsMsg}`);
        }
      }
    }

    // Verify all tables were created
    console.log("\n🔍 Verifying table creation...");
    const finalTables = await ScyllaDb.listTables();
    const finalTableNames = finalTables.TableNames || [];

    console.log(`\n📊 Setup Summary:`);
    console.log(
      `   Total tables configured: ${Object.keys(tablesConfig).length}`
    );
    console.log(`   Total tables in database: ${finalTableNames.length}`);

    // Show which tables are now available
    console.log(`\n📋 Available tables:`);
    finalTableNames.forEach((tableName, index) => {
      const isNew = !existingTableNames.includes(tableName);
      const status = isNew ? "🆕 NEW" : "✅ EXISTING";
      console.log(`   ${index + 1}. ${tableName} ${status}`);
    });

    // Show table details
    console.log(`\n📝 Table Details:`);
    for (const tableName of finalTableNames) {
      try {
        const description = await ScyllaDb.describeTable(tableName);
        const table = description.Table || description;
        console.log(`\n   📄 ${tableName}:`);
        console.log(`      Status: ${table.TableStatus || "ACTIVE"}`);
        console.log(`      Items: ${table.ItemCount || 0}`);
        console.log(`      Size: ${table.TableSizeBytes || 0} bytes`);
      } catch (error) {
        console.log(
          `\n   📄 ${tableName}: Unable to get details (${error.message})`
        );
      }
    }

    console.log(`\n🎉 Table setup completed successfully!`);
  } catch (error) {
    console.error("❌ Table setup failed:", error.message);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  }
}

// Add helper function to drop all tables (useful for cleanup)
async function dropAllTables() {
  try {
    console.log("🗑️  Dropping all tables...");

    const tables = await ScyllaDb.listTables();
    const tableNames = tables.TableNames || [];

    if (tableNames.length === 0) {
      console.log("ℹ️  No tables to drop");
      return;
    }

    for (const tableName of tableNames) {
      try {
        console.log(`🗑️  Dropping table: ${tableName}`);
        await ScyllaDb.deleteTable(tableName);
        console.log(`✅ Table '${tableName}' dropped`);

        // Wait a moment between drops
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`❌ Failed to drop table '${tableName}':`, error.message);
      }
    }

    console.log("🎉 All tables dropped successfully!");
  } catch (error) {
    console.error("❌ Drop tables failed:", error.message);
    process.exit(1);
  }
}

// Command line interface
const command = process.argv[2];

switch (command) {
  case "create":
  case "setup":
    setupTables();
    break;
  case "drop":
  case "clean":
    dropAllTables();
    break;
  case "recreate":
    console.log("🔄 Recreating all tables...");
    await dropAllTables();
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
    await setupTables();
    break;
  default:
    console.log(`
🏗️  Table Setup Script Usage:

Setup tables:
  node setup-tables.js setup
  node setup-tables.js create

Drop all tables:
  node setup-tables.js drop
  node setup-tables.js clean

Recreate all tables:
  node setup-tables.js recreate

Available tables will be created based on tables.json configuration.
    `);
}
