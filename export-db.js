import Database from "@replit/database";
import fs from "fs";

const db = new Database();

async function exportDB() {
  const keys = await db.list();
  const data = {};

  for (const key of keys) {
    data[key] = await db.get(key);
  }

  fs.writeFileSync("replit_database_backup.json", JSON.stringify(data, null, 2));
  console.log("Database exported successfully");
}

exportDB();