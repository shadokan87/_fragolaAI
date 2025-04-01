// Base exception class
export class FragolaError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FragolaError';
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, FragolaError);
        }
    }
}

// Specific exception class
export class AgentNotFoundError extends FragolaError {
    constructor(agentId: string) {
        super(`You tried to call \`createRun\` with agent ID "${agentId}" but it was not found.`);
        this.name = 'AgentNotFoundError';
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, AgentNotFoundError);
        }
    }
}

// Specific exception class
export class AgentConfigError extends FragolaError {
    constructor(agentId: string, message: string) { //TODO: remove agentId parameter
        super(`Agent '${agentId}': message`);
        this.name = 'AgentConfigError';
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, AgentConfigError);
        }
    }
}

// Specific exception class
export class ToolConfigError extends FragolaError {
    constructor(message: string) {
        super(message);
        this.name = 'ToolConfigError';
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ToolConfigError);
        }
    }
}