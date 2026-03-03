import { defineCommand } from "citty";
import { render } from "ink";
import { HelpApp } from "../help/components/HelpApp";
import { topics, getTopic } from "../help/content";

export default defineCommand({
  meta: {
    description: "Interactive help system with man-style navigation",
  },
  args: {
    topic: {
      type: "positional",
      description: "Help topic to display",
      required: false,
    },
  },
  async run({ args }) {
    const topicArg = args.topic as string | undefined;

    // If topic specified but not found, show available topics
    if (topicArg && !getTopic(topicArg)) {
      console.log(`Unknown topic: ${topicArg}`);
      console.log("\nAvailable topics:");
      for (const t of topics) {
        console.log(`  ${t.id.padEnd(12)} - ${t.shortDesc}`);
      }
      process.exit(1);
    }

    // Render interactive help
    render(<HelpApp initialTopic={topicArg} />);
  },
});
