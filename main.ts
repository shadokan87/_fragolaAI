// import { agentNavigation } from "./ai/agents/navigation/agentNavigation";
import OpenAI from "openai";
import { Fragola } from "./lib";

console.log("Hello via Bun!");
async function main() {
    const fragola = new Fragola({
        streaming: async (body) => {
            return await new OpenAI({ apiKey: "xxx" }).chat.completions.create(body);
        }
    })
    await fragola.init();
}

(async () => {
    await main();
})();
