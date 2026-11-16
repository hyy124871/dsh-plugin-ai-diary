const fs = require("fs");
const src = JSON.parse(fs.readFileSync("out/day28-specimen.json", "utf8"));
src.episode.character = "deepseek";
fs.writeFileSync("out/day28-specimen--deepseek.json", JSON.stringify(src, null, 2));
console.log("episode.character =", src.episode.character, "shots =", (src.shots || []).length);