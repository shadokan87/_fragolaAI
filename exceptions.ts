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
        super(`Agent with ID "${agentId}" was not found.`);
        this.name = 'AgentNotFoundError';
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, AgentNotFoundError);
        }
    }
}

// export class AgentDuplicateError extends FragolaError {
//     constructor(agentId: string, group?: string) {
//         super(`A`)
//     }
// }