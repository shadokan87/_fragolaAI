import openai, { OpenAI } from "openai";
import type { Stream } from "openai/streaming.mjs";
import { TreeService, type TreeResult } from "./services/treeService";
import { existsSync, readFile, readFileSync } from "fs";
import { join } from "path";
import type { z } from "zod";

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
        /**
         * Use an instruction as system prompt, will ignore prompt files
         */
        instructions?: string,
        /**
         * Use a `.md` prompt file present in agent directory. Input the name of the file only without `.md`.
         * Defaults to `default.md`
         */
        prompt?: string
    }

    export interface ToolConfig<T extends z.ZodType<any, any>> {
        name: string,
        description: string,
        handler: (parameters: z.infer<T>) => string,
        schema: T
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
        group?: string;

        /**
         * Indicates if the tool is a Bash file.
         */
        isBashFile?: boolean;
        config: ToolConfig<any>
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
    public static createTool = <T extends z.ZodType<any, any>>(config: Fragola.ToolConfig<T>): Fragola.ToolConfig<T> => config;

    private updateProject(callback: (prev: Fragola.Project) => Fragola.Project) {
        this.project = callback(this.project);
        console.log(this.project.tools[1]?.config);
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
                    throw new Error(`Failed to find source code file for agent: ${agent.name}. Expected file name to be: \`+agent\`.ts or \`+agent.js\``);
                }

                const configFunction = await import(agentFsNode.custom.fullPath);
                const _default = configFunction["default"];
                if (!_default) {
                    throw new Error(`Failed to load config for agent \`${agent.name}\`. Make sure to use the \`createAgent\` function`);
                }

                const config: Fragola.AgentConfig = _default;
                // Retrieving prompts
                const promptsFsNodes = agent.children?.filter(child => child.name.endsWith(".md"));
                const handlePromptFile = async (node: TreeResult): Promise<Fragola.PromptFile> => {
                    try {
                        const content = readFileSync(node.custom.fullPath, 'utf-8'); // Specify encoding
                        return {
                            name: node.name,
                            path: node.custom.fullPath,
                            content: content
                        };
                    } catch (error) {
                        console.error(`Failed to read prompt file at '${node.custom.fullPath}'':`, error);
                        throw error; // Rethrow the error if you want to handle it further up the call stack
                    }
                };
                if (!promptsFsNodes?.length) {
                    //TODO: create default.md prompt
                }
                const prompts = promptsFsNodes ? await Promise.all(promptsFsNodes.map(node => handlePromptFile(node))) : [];
                // agentData.prompts = prompts;
                // console.log(agentFsNode);
                let agentData: Fragola.Agent = {
                    name: agent.name,
                    path: agent.path,
                    prompts,
                    config
                }
                // console.log(agentData);
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
            // console.log(allAgents);
        } else
            console.warn("Fragola: no agent found")
        if (tools) {
            const isToolFile = (fileName: string) => fileName.endsWith(".tool.ts") || fileName.endsWith(".tool.js");
            // Folders of tools group
            const allSubDirectories = tools.children?.filter(child => child.type == "directory");
            // Tools without folders
            const individualTools = tools.children?.filter(child => child.type == "file" && isToolFile(child.name));

            const getToolConfigFromFile = async (node: TreeResult, parentDirNode?: TreeResult) => {
                const configFunction = await import(node.custom.fullPath);
                const _default  = configFunction["default"];
                if (!_default) {
                    throw new Error(`Failed to load config for tool '${node.name}'`);
                }
                // console.log("default", _default);
                const config: Fragola.ToolConfig<any> = _default;
                const tool: Fragola.Tool = {
                    group: parentDirNode && parentDirNode.name || undefined,
                    config
                }
                // console.log("tool", tool);
                this.updateProject((prev) => {
                    return {
                        ...prev,
                        tools: [
                            ...prev.tools,
                            tool
                        ]
                    }
                })
            }
            await Promise.all(allSubDirectories?.map(async node => {
                const allTools = node.children?.filter(child => child.type == "file" && isToolFile(child.name));
                if (allTools?.length)
                    await Promise.all(allTools?.map(async tool => await getToolConfigFromFile(tool, node)));
            }) || []);

            await Promise.all(individualTools?.map(async node => {
                await Promise.all(individualTools.map(async tool => await getToolConfigFromFile(tool)));
            }) || [])
        } else
            console.warn("Fragola: no tools found");
        // console.log("tree: ", tree);
    }
}