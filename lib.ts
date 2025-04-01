import openai, { OpenAI } from "openai";
import type { Stream } from "openai/streaming.mjs";
import { TreeService, type TreeResult } from "./services/treeService";
import { existsSync, readFile, readFileSync } from "fs";
import { join } from "path";
import type { z } from "zod";
import { nanoid } from "nanoid";
import { AgentConfigError, AgentNotFoundError, FragolaError, ToolConfigError } from "./exceptions";
import type { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions.mjs";
import { streamChunkToMessage } from "./utils";
import { zodToJsonSchema } from "openai/_vendor/zod-to-json-schema/zodToJsonSchema.mjs";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/src/resources.js";
import xml2js from "xml2js";

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

        prompt?: string //TODO
    }

    export interface ToolConfig<T extends z.ZodType<any, any>> {
        name: string,
        description: string,
        handler: (parameters: z.infer<T>) => maybePromise<string>,
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

    export type runEventType =
        "conversationUpdate"
        |
        "streamStart"
        | "streamChunk"
        | "streamEnd"
        | "runStart"
        | "runEnd"
        | "toolRequested"
        | "toolSubmitSuccess"
        | "toolSubmitError"

    type maybePromise<T> = Promise<T> | T;
    //@prettier-ignore
    export type runHookCallBackMap = {
        [K in Fragola.runEventType]
        : K extends "conversationUpdate" ? (controller: RunController, conversation: OpenAI.ChatCompletionMessageParam[]) => maybePromise<void>
        : K extends "streamStart" | "streamEnd" ? (controller: RunController) => maybePromise<void>
        : K extends "streamChunk" ? (controller: RunController, chunk: OpenAI.Chat.Completions.ChatCompletionChunk) => maybePromise<void>
        : K extends "runStart" | "runEnd" ? (controller: RunController) => maybePromise<void>
        : K extends "toolRequested" ? (controller: RunController, toolName: string, parameters: any) => maybePromise<void>
        : K extends "toolSubmitSuccess" | "toolSubmitError" ? (controller: RunController, toolName: string, result: any) => maybePromise<void>
        : never;
    };

    export interface RunController {
        isRunning: boolean;
        stopRun(): void,
    }

    export type runHook = (controller: RunController, conversation: OpenAI.ChatCompletionMessageParam[]) => void;
}

export interface hookStore<K extends keyof Fragola.runHookCallBackMap> {
    id: string,
    // name: K,
    fn: Fragola.runHookCallBackMap[K]
}

export type messageRouterMap = { default: Run } & Record<string, Run>;
const messageRouterSentinel = "__INTERNAL_MESSAGE_ROUTER__";

export class MessageRouter {
    constructor(router: messageRouterMap) {
        if (!router["default"])
            throw new FragolaError("A router must contain a default agent")
    }
}

export class Fragola {
    private project: Fragola.Project = {
        tools: [],
        agents: []
    }

    private runs: Record<string, Run> = {}

    constructor(private sdk: OpenAI) { }

    public static createAgent = (config: Fragola.AgentConfig) => config;
    public static createTool = <T extends z.ZodType<any, any>>(config: Fragola.ToolConfig<T>): Fragola.ToolConfig<T> => config;

    private updateProject(callback: (prev: Fragola.Project) => Fragola.Project) {
        this.project = callback(this.project);
    }

    public createMessageRouter(router: messageRouterMap): MessageRouter {
        const defaultPrivate = router["default"][FragolaFriend];
        const textRouter: Record<string, string> = {};

        for (const key in router) {
            if (key != "default") {
                const agent = router[key];
                if (!agent.agent)
                    throw new FragolaError("Agent undefined"); //TODO: better error message
                textRouter[agent.agent.name] = key;
            }
        }
        console.log(JSON.stringify(textRouter, null, 2));
        defaultPrivate.updateRunConfig((prev) => {
            // const internalRouterTool: Fragola.Tool = {
            //     group: messageRouterSentinel,
            //     config: {
            //         name: `${messageRouterSentinel}: dispatchToAnotherAgent`,
            //         description: `You can dispatch a user message to another agent that is specialized to handle it. `
            //     }
            // }
            return prev;
        })
        // for (const key in router) {
        //     const privateMethods
        //     // if (!(router[key] instanceof Run)) {
        //     //     throw new FragolaError(`Router key '${key}' must be a Run instance`);
        //     // }
        // }
        return new MessageRouter(router);
    }

    public createRun(agentName: Fragola.Agent["name"], params: Omit<ChatCompletionCreateParamsBase, "messages" | "tools">): Run {
        const run = new Run(agentName, params, this.project, this.sdk);
        this.runs[run.id] = run;
        return run;
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
                const agentFsNode = agent.children?.find(child => child.name == "agent.ts" || child.name == "agent.js");
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
                            name: node.name.split(".")[0],
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
                const _default = configFunction["default"];
                if (!_default) {
                    throw new Error(`Failed to load config for tool '${node.name}'`);
                }
                const config: Fragola.ToolConfig<any> = _default;
                const tool: Fragola.Tool = {
                    group: parentDirNode && parentDirNode.name || undefined,
                    config
                }
                const split = node.name.split("."); // TODO: check proper length and format
                const fileToolName = node.name.split(".")[0];
                if (!fileToolName || fileToolName != tool.config.name)
                    throw new ToolConfigError(`File name for tool '${tool.config.name}' must be indentical. Expected '${config.name}.tool.${split[split.length - 1]}' but got ${fileToolName}.tool.${split[split.length - 1]}`);
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
    }
}

const FragolaFriend = Symbol('FragolaFriend');

type RunXMLConfigInstruction = {
    $: { type: "text" };
    _: string;
};

interface RunXMLConfig {
    fragola: {
        systemPrompt: {
            generalInstructions: RunXMLConfigInstruction,
            agentRoutingInstructions?: RunXMLConfigInstruction,
            otherAgents?: {
                tool: {
                    $: { name: string };
                    _: string
                }[];
            };
        };
    };
}

export class Run {
    private controller: Fragola.RunController | undefined = undefined;
    public id: string;
    private isRunning: boolean = false;
    public agent: Fragola.Agent | undefined;
    private hooks: Map<Fragola.runEventType, hookStore<any>[]> = new Map();
    private conversation: OpenAI.ChatCompletionMessageParam[] = [];
    private systemPrompt: OpenAI.ChatCompletionSystemMessageParam = { role: "system", content: "" };
    private runConfig: {
        agentTools: Fragola.Tool[]
    } = { agentTools: [] }
    private paramsTools: ChatCompletionCreateParamsBase["tools"] = [];
    //@ts-ignore: variable is begin set with `updateXML` method
    private runSystemPromptXMLObject: RunXMLConfig;
    //@ts-ignore: variable is begin set with `updateXML` method
    private runSystemPromptXML: string;
    private xmlBuilder = new xml2js.Builder();

    constructor(agentName: string, private params: Omit<ChatCompletionCreateParamsBase, "messages" | "tools">, private project: Fragola.Project, private sdk: OpenAI) {
        this.id = nanoid();
        this.agent = project.agents.find(agent => agent.name == agentName);
        if (!this.agent)
            throw new AgentNotFoundError(agentName);
        const agent: Fragola.Agent = this.agent;
        this.agentToRunConfig();
        this.controller = {
            isRunning: this.isRunning,
            stopRun: () => { },
        }
        if (!agent.config.prompt && !agent.config.instructions) {
            const _default = agent.prompts.find(prompt => prompt.name == "default");
            if (!_default)
                throw new AgentConfigError(agent.name, "No instructions given for agent.\n- create a default.md file\n- create a .md prompt file and pass the name to `prompt` parameter of createAgent function\n- Provide `instructions` parameter to `createAgent` function\n");
            this.systemPrompt = { role: "system", content: _default.content };
        } else if (agent.config.prompt && !agent.config.instructions) {
            const prompt = agent.prompts.find(prompt => prompt.name == agent?.config.prompt);
            if (!prompt)
                throw new AgentConfigError(agent.name, `\`prompt\` parameter provided but the file does not exist. Expected file with name: ${agent.config.prompt}.md`)
        } else if (agent.config.instructions) {
            if (agent.config.prompt)
                console.warn(`Agent ${agent.name}: prompt \`${agent.config.prompt}\` has been ignored because \`instructions\` parameter is provided.`);
            this.systemPrompt = { role: "system", content: agent.config.instructions }
        } else
            throw new AgentConfigError(agent.name, "");

        this.updateXML(() => ({
            fragola: {
            systemPrompt: {
                generalInstructions: {
                $: { type: "text" },
                _: `This part of the system prompt (inside the <fragola><fragola/> tags) may or may not contain extra instructions that are generated by fragola, an AI agent library. If there is only the <generalInstructions>, it means there is 0 extra instructions given to you.
                Instructions are considered 'extra' because they are not written by the user himself but injected at runtime by the library.`
                }
            }
            }
        }));
    }

    private updateXML(callback: (prev: typeof this.runSystemPromptXMLObject) => typeof this.runSystemPromptXMLObject) {
        this.runSystemPromptXMLObject = callback(this.runSystemPromptXMLObject);
        this.runSystemPromptXML = this.xmlBuilder.buildObject(this.runSystemPromptXMLObject)
            .split('\n')
            .slice(1)
            .join('\n');
        console.log(this.runSystemPromptXML);
    }

    private updateRunConfig(callback: (prev: typeof this.runConfig) => typeof this.runConfig) {
        this.runConfig = callback(this.runConfig);
        this.toolsToParamsTools();
    }

    private updateSystemPrompt(callback: (prev: typeof this.systemPrompt) => typeof this.systemPrompt) {
        this.systemPrompt = callback(this.systemPrompt);
    }

    [FragolaFriend] = {
        updateRunConfig: this.updateRunConfig,
        updateSystemPrompt: this.updateSystemPrompt
    }

    private async agentToRunConfig() {
        const toolPattern = /^[a-zA-Z0-9-_]+(?:\/(?:[a-zA-Z0-9-_]+|\*))?$/;
        if (!this.agent) {
            // TODO: handle error
            return;
        }
        const agent: Fragola.Agent = this.agent;
        const tools: Fragola.Tool[] = agent.config.tools.flatMap(str => {
            if (!toolPattern.test(str))
                throw new AgentConfigError(agent.name,
                    `Invalid tool pattern: "${str}". Tools must follow format: "toolName" or "groupName/toolName" or "groupName/*". ` +
                    `Examples: "calculator", "math/calculator", "filesystem/*"`
                );
            if (str.includes("/")) {
                const split = str.split("/");
                const groupName = split[0];
                const name = split[1];
                const groupNameExist = this.project.tools.find(tool => tool.group == groupName);
                if (!groupNameExist)
                    throw new AgentConfigError(agent.name, `Group with name '${groupName}' does not exist or contains 0 tools`);

                if (name == "*") {
                    const filteredTools = this.project.tools.filter((tool) => tool.group == groupName);
                    if (!filteredTools.length)
                        console.warn(`Group name '${groupName}' is correct but contains 0 tools. For wildcard expression.`);
                    return filteredTools;
                } else {
                    const found = this.project.tools.find((tool) => tool.group == groupName && tool.config.name == name);
                    if (!found)
                        throw new AgentConfigError(agent?.name, `Tool with name '${name} does not exist, for group name ${groupName}'`);
                    return found;
                }
            } else {
                const found = this.project.tools.find((tool) => tool.config.name == str);
                if (!found)
                    throw new AgentConfigError(agent.name, `Tool with name '${str}' does not exist`);
                return found;
            }
        }) || [];
        this.runConfig.agentTools = tools;
        // console.log(JSON.stringify(this.runConfig, null, 2));
    }

    private toolsToParamsTools() {
        const result: ChatCompletionCreateParamsBase["tools"] = [];
        this.runConfig.agentTools.forEach(tool => {
            result.push({
                type: "function",
                function: {
                    name: tool.config.name,
                    description: tool.config.description,
                    parameters: zodToJsonSchema(tool.config.schema)
                }

            })
        });
        this.paramsTools = result;
    }

    public start(): void {
        this.toolsToParamsTools();
        this.isRunning = true;
        console.log(this.paramsTools);
    }

    public getConversation(): openai.Chat.Completions.ChatCompletionMessageParam[] {
        return this.conversation;
    }

    public setConversation(callback: (prev?: OpenAI.ChatCompletionMessageParam[]) => OpenAI.ChatCompletionMessageParam[], overrideSystemRole?: boolean): void {
        let newConversation = callback(this.conversation);
        if (!overrideSystemRole) {
            const firstMessage = this.conversation.at(0);
            if (firstMessage && firstMessage.role == "system")
                newConversation.shift();
        }
        this.conversation = newConversation;
    }


    public registerHook<K extends Fragola.runEventType>(name: K, callback: Fragola.runHookCallBackMap[K]): () => void {
        const id = nanoid();
        const prev = this.hooks.get(name);
        const hook: hookStore<any> = { id, fn: callback };
        if (prev) {
            this.hooks.set(name, [...prev, hook])
        } else {
            this.hooks.set(name, [hook]);
        }
        return () => {
            const prev = this.hooks.get(name);
            if (prev) {
                const filtered = prev.filter(hook => hook.id != id);
                if (filtered.length != prev.length) {
                    if (filtered.length == 0)
                        this.hooks.delete(name);
                    else
                        this.hooks.set(name, filtered);
                }
            }
        }
    }

    private getLastMessage(withSystemPrompt?: boolean): openai.Chat.Completions.ChatCompletionMessageParam | undefined {
        if (!withSystemPrompt && this.conversation.length == 1)
            return undefined;
        return this.conversation.at(-1);
    }

    private async applyHook<K extends Fragola.runEventType>(name: K, ...args: Parameters<Fragola.runHookCallBackMap[K]>): Promise<void> {
        const hooks = this.hooks.get(name);
        if (hooks) {
            for (const hook of hooks) {
                const typedFn = hook.fn as (...params: Parameters<Fragola.runHookCallBackMap[K]>) => ReturnType<Fragola.runHookCallBackMap[K]>;
                const isAsync = typedFn.constructor.name == "AsyncFunction";
                if (isAsync) {
                    await typedFn(...args);
                }
                else {
                    typedFn(...args);
                }
            }
        }
    }

    private updateConversation(callback: (prev: OpenAI.ChatCompletionMessageParam[]) => OpenAI.ChatCompletionMessageParam[]): void {
        // const hooks = this.hooks.get("conversationUpdate");
        this.conversation = callback(this.conversation);
        this.applyHook("conversationUpdate", this.controller!, this.conversation);
    }

    private appendMessages(messages: OpenAI.ChatCompletionMessageParam[], replaceLast: boolean = false) {
        this.updateConversation((prev) => {
            if (replaceLast)
                return [...prev.slice(0, -1), ...messages];
            return [...prev, ...messages]
        });
    }

    private async recursiveAgent(iter = 0): Promise<void> {
        if (iter == 5) {
            console.error("max iter");
            return;
        }
        const stream = await this.sdk.chat.completions.create({ ...this.params, messages: [{...this.systemPrompt, content: this.runSystemPromptXML + "\n" + this.systemPrompt.content}, ...this.conversation], tools: this.paramsTools?.length ? this.paramsTools : [] });
        let aiMessage: Partial<OpenAI.Chat.ChatCompletionMessageParam> = {};
        if (Symbol.asyncIterator in stream) {
            let replaceLast = false;

            // Streaming
            this.applyHook("streamStart", this.controller!);
            for await (const chunk of stream) {
                this.applyHook("streamChunk", this.controller!, chunk);
                aiMessage = streamChunkToMessage(chunk, aiMessage);
                this.appendMessages([aiMessage as OpenAI.Chat.ChatCompletionMessageParam], replaceLast);
                replaceLast = true;
            }
            this.applyHook("streamEnd", this.controller!);

            // Tool calls
            if (aiMessage.role == "assistant" && aiMessage.tool_calls && aiMessage.tool_calls.length) {
                await Promise.all(aiMessage.tool_calls.map(async toolCall => {
                    // Find tool in project that matches the tool requested by last ai message
                    const tool = this.project.tools.find(tool => tool.config.name == toolCall.function.name);
                    if (!tool) {
                        console.error(`Tool with name ${toolCall.function.name} not found in project`); //TODO: replace with exception
                        return;
                    }
                    let paramsParsed: z.SafeParseReturnType<any, any> | undefined;
                    if (tool.config.schema) {
                        paramsParsed = (tool.config.schema as z.Schema).safeParse(JSON.parse(toolCall.function.arguments));
                        if (!paramsParsed.success) {
                            //TODO: implement retry system for bad arguments
                            throw new FragolaError("Tool arguments parsing fail");
                        }
                    }
                    const content = tool.config.handler?.constructor.name == "AsyncFunction" ? await tool.config.handler(paramsParsed?.data) : tool.config.handler(paramsParsed?.data);
                    const message: ChatCompletionMessageParam = {
                        role: "tool",
                        content: JSON.stringify(content),
                        tool_call_id: toolCall.id
                    }
                    this.updateConversation((prev) => [...prev, message]);
                }));
                return await this.recursiveAgent(iter + 1);
            }
        }
    }

    public async userMessage(message: Omit<OpenAI.Chat.ChatCompletionUserMessageParam, "role">): Promise<boolean> {
        if (!this.isRunning) {
            console.warn("You called userMessage() without calling start()");
            return false;
        }
        const lastMessage = this.getLastMessage();
        const canAppend: boolean = !lastMessage || (
            lastMessage.role == "assistant"
        );
        if (canAppend) {
            this.updateConversation(prev => [...prev, { role: "user", ...message }]);
            await this.recursiveAgent();
            return true;
        }
        return false;
    }
}