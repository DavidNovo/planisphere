import fs from "fs";
const files = fs.existsSync("css") ? fs.readdirSync("css").filter(f => f.endsWith(".css")).sort() : [];
fs.writeFileSync("styles.css", files.map(f => `/* ${f} */\n` + fs.readFileSync("css/" + f, "utf8")).join("\n"));
console.log("styles.css from", files.join(", ") || "(none)");
