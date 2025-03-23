import openai, { OpenAI } from "openai";
import type { Stream } from "openai/streaming.mjs";
import { TreeService } from "./services/treeService";
import { existsSync } from "fs";
import { join } from "path";

export interface CreateAgentOptions {
    toolGroup?: string[],
    tools?: string[],
    /**
    * System prompt to use for the agent, defaults to 'default*' prompt file in the agent directory
    */
    systemPrompt?: string,
}

export type CreateAgentOptionsStreaming = CreateAgentOptions & { streaming: true };

/**
 * Namespace containing interfaces for the Fragola project.
 */
export namespace Fragola {
    /**
     * Represents a file used in prompts.
     */
    export interface PromptFile {
        /**
         * The name of the file.
         */
        name: string;

        /**
         * The absolute path of the file.
         */
        path: string;

        /**
         * The content of the file.
         */
        content: string;
    }

    export interface AgentConfig {
        tools: string[],
    }

    /**
     * Represents an agent with associated prompts.
     */
    export interface Agent {
        /**
         * An array of prompt files associated with the agent.
         */
        prompts: PromptFile[];

        /**
         * The name of the agent.
         */
        name: string;

        /**
         * The absolute path of the agent.
         */
        path: string;
        config: AgentConfig
    }

    /**
     * Represents a tool used in the project.
     */
    export interface Tool {
        /**
         * The group to which the tool belongs.
         */
        group: string;

        /**
         * Indicates if the tool is a Bash file.
         */
        isBashFile?: boolean;
    }

    /**
     * Represents a project containing tools and agents.
     */
    export interface Project {
        /**
         * An array of tools used in the project.
         */
        tools: Tool[];

        /**
         * An array of agents used in the project.
         */
        agents: Agent[];
    }
}

type FragolaStreamingCallback = (body: OpenAI.Chat.ChatCompletionCreateParamsStreaming) => Promise<Stream<OpenAI.Chat.Completions.ChatCompletionChunk> & {
    _request_id?: string | null;
}>

export class Fragola {
    constructor(aiRequest: {
        streaming: FragolaStreamingCallback
    }, private project: Fragola.Project = {
        tools: [],
        agents: []
    }) {

    }
    public static createAgent = (config: Fragola.AgentConfig) => config;

    private updateProject(callback: (prev: Fragola.Project) => Fragola.Project) {
        this.project = callback(this.project);
    }

    public async init() {
        if (!process.env["PWD"])
            throw new Error("PWD env variable not set");
        const fragolaPath = join(process.env["PWD"], "_fragola")
        if (!existsSync(fragolaPath))
            throw new Error("_fragola folder must exist at the root of your project");
        const treeService = new TreeService(fragolaPath);
        const tree = await treeService.list();
        const agents = tree.children?.find(child => child.type == "directory" && child.name == "agents");
        const tools = tree.children?.find(child => child.type == "directory" && child.name == "tools");

        if (agents) {
            const allAgents = agents.children?.filter(child => child.type == "directory");
            allAgents?.forEach(async agent => {
                const agentFsNode = agent.children?.find(child => child.name == "+agent.ts" || child.name == "+agent.js");
                if (!agentFsNode) {
                    throw new Error(`Failed to find source code file for agent: ${agent.name}. Make sure to name it like so: +agent.ts or +agent.js`)
                }
                const configFunction = await import(agentFsNode.custom.fullPath);
                const _default = configFunction["default"];
                if (!_default) {
                    throw new Error(`Failed to retrieve config for agent \`${agent.name}\`. Make sure to use the \`createAgent\` function`);
                }
                const config: Fragola.AgentConfig = _default;
                // console.log(agentFsNode);
                let agentData: Fragola.Agent = {
                    prompts: [],
                    name: agent.name,
                    path: agent.path,
                    config
                }
                console.log(agentData);
                this.updateProject((prev) => {
                    return {
                        ...prev,
                        agents: [
                            ...prev.agents,
                            agentData
                        ]
                    }
                })
            });
            console.log(allAgents);
        } else
            console.warn("Fragola: no agent found")
        if (tools) {

        } else
            console.warn("Fragola: no tools found");
        // console.log("tree: ", tree);
    }
}

let project: Fragola.Project = {
    tools: [],
    agents: []
}

// export function createAgent(options: CreateAgentOptions | CreateAgentOptionsStreaming): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming | OpenAI.Chat.ChatCompletionCreateParamsStreaming {
//     // const agent = project.agents.find(agent => agent.name == "navigation")
//     // const systemPrompt = (() => {
//     //     if (options.systemPrompt)
//     //         return options.systemPrompt;
//     // })();
//     // if ("steaming" in options) {
//     //     // let body: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {

//     //     // }
//     // } else {

//     // }
// }