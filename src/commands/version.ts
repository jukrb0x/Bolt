import { defineCommand } from "citty";
import { VERSION } from "../version";

export default defineCommand({
  meta: { name: "version", description: "Print bolt version" },
  run() {
    console.log(VERSION);
  },
});
