import { defineCommand } from "citty";
import { VERSION } from "../version";

export default defineCommand({
  meta: { description: "Print bolt version" },
  run() {
    console.log(VERSION);
  },
});
