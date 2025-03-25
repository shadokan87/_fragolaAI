// import { agentNavigation } from "./ai/agents/navigation/agentNavigation";
import OpenAI from "openai";
import { Fragola } from "./lib";

async function main() {
    const fragola = new Fragola({
        streaming: async (body) => {
            return await new OpenAI({ apiKey: "xxx" }).chat.completions.create(body);
        }
    });

    await fragola.init();
    const navigationRun = fragola.createRun("navigation");
    navigationRun.userMessage({content: "asadasdasd"});

    // navigationRun.registerHook("toolRequested", (controller) => {
        
    // });

    // navigationRun.registerHook("runStart", ())
    // let history: OpenAI.ChatCompletionMessageParam[] = [];
    
}

(async () => {
    await main();
})();
