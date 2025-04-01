// import { agentNavigation } from "./ai/agents/navigation/agentNavigation";
import OpenAI from "openai";
import { Fragola } from "./lib";
import { PORTKEY_GATEWAY_URL, createHeaders } from "portkey-ai";

async function main() {
    const openai = new OpenAI({
      apiKey: 'xxx',
      baseURL: PORTKEY_GATEWAY_URL,
      defaultHeaders: createHeaders({
        virtualKey: process.env["BEDROCK_DEV"],
        apiKey: process.env["PORTKEY_API_KEY"]})
    });

    const fragola = new Fragola(openai);

    await fragola.init();
    let conversation: OpenAI.ChatCompletionMessageParam[] = [];
    const navigationRun = fragola.createRun("navigation", {
        model: 'us.anthropic.claude-3-5-haiku-20241022-v1:0' as any,
        temperature: 1,
        stream: true,
        tool_choice: "auto"
    });

    const dispatch = fragola.createDispatch({
        "default": navigationRun,
        "the user wants to refund an artile": navigationRun
    });

    navigationRun.registerHook("conversationUpdate", async (controller, messages) => {
        console.log("messages: ", messages);
        // conversation = messages
    });
    navigationRun.start();
    await navigationRun.userMessage({content: "what is the weather in Paris"});
    // await navigationRun.userMessage({content: "what is the weather in san Francisco"});
    // await navigationRun.userMessage({content: "what is the weather in Mexico"});
    // await navigationRun.userMessage({content: "write a short poem"});
    
}

(async () => {
    await main();
})();
